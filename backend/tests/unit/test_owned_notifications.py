"""Account-isolation regressions using a disposable SQLite harness, no providers."""
from contextlib import contextmanager
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError
from app.db.schema import metadata
from app.db.engine import Connection
import app.notifications.repository as targets
from app.notifications import service as notification


class OwnedNotificationsTests(unittest.TestCase):
    def setUp(self):
        self.engine = sa.create_engine('sqlite://')
        metadata.create_all(self.engine)
        self.addCleanup(self.engine.dispose)
        with self.engine.begin() as conn:
            conn.execute(metadata.tables['users'].insert(), [{'id': 1}, {'id': 2}])
        self.body = SimpleNamespace(channel='telegram', friendlyName='Team', chatId='-123456', active=True)

        @contextmanager
        def connection():
            with Connection(self.engine.connect()) as conn:
                yield conn

        def read(sql, args):
            with connection() as conn:
                return conn.execute(sql, args).fetchall()

        for mocked in (patch.object(targets, 'connection', connection),
                       patch.object(targets, 'read_rows', read),
                       patch.object(Connection, 'begin_serialized')):
            mocked.start()
            self.addCleanup(mocked.stop)

    def test_crud_isolation_uniqueness_and_legacy_quarantine(self):
        first = targets.save_target('accounts', self.body, owner_user_id=1)
        second = targets.save_target('accounts', self.body, owner_user_id=2)
        with self.assertRaises(IntegrityError):
            targets.save_target('accounts', self.body, owner_user_id=1)
        self.assertEqual([x['id'] for x in targets.list_targets(owner_user_id=1)], [first['id']])
        self.assertEqual([x['id'] for x in targets.list_targets(owner_user_id=2)], [second['id']])
        with self.assertRaises(KeyError):
            targets.save_target('accounts', self.body, first['id'], owner_user_id=2)
        with self.assertRaises(KeyError):
            targets.delete_target('accounts', first['id'], owner_user_id=2)
        with self.engine.begin() as conn:
            conn.execute(metadata.tables['notification_targets'].insert(), dict(
                id='legacy', kind='accounts', channel='zalo', friendly_name='Old', chat_id='old', active=1))
        self.assertEqual(targets.list_targets(), [])
        self.assertEqual(len(targets.list_targets(owner_user_id=1)), 1)
        targets.delete_target('accounts', first['id'], owner_user_id=1)
        self.assertEqual(targets.list_targets(owner_user_id=1), [])

    def test_capacity_is_per_account_and_saves_do_not_change_global_switches(self):
        for index in range(20):
            self.body.chatId = str(100000 + index)
            targets.save_target('accounts', self.body, owner_user_id=1)
        with self.assertRaises(ValueError):
            targets.save_target('accounts', self.body, owner_user_id=1)
        targets.save_target('accounts', self.body, owner_user_id=2)
        self.assertEqual(len(targets.list_targets(owner_user_id=2)), 1)
        with self.engine.connect() as conn:
            self.assertEqual(conn.scalar(sa.select(sa.func.count()).select_from(metadata.tables['settings'])), 0)

    def test_delivery_uses_owner_and_never_global_fallback(self):
        targets.save_target('accounts', self.body, owner_user_id=1)
        def setting(key):
            return 'token' if key.endswith('bot_token') else 'true' if key.endswith('enabled') else 'legacy-global-chat'
        with patch.object(notification, 'setting', side_effect=setting), \
             patch.object(notification, 'send_telegram', return_value=True) as sender:
            first = notification.trigger_notifications('fire', .9, channels=('telegram',), owner_user_id=1)
            second = notification.trigger_notifications('fire', .9, channels=('telegram',), owner_user_id=2)
            unowned = notification.trigger_notifications('fire', .9, channels=('telegram',))
        self.assertEqual(first['telegram']['status'], 'sent')
        self.assertEqual(second['telegram']['status'], 'unconfigured')
        self.assertEqual(unowned['telegram']['status'], 'unconfigured')
        self.assertEqual(sender.call_count, 1)
        self.assertEqual(sender.call_args.kwargs['chat_id'], self.body.chatId)

    def test_camera_delivery_resumes_at_fifteen_seconds_for_both_channels(self):
        config = {'enabled': True, 'configured': True,
                  'targets': [{'id': 'test', 'chatId': '123'}]}
        with patch.object(notification, 'last_notification', {}), \
             patch.object(notification, '_in_flight', set()), \
             patch.object(notification, 'channel_config', return_value=config), \
             patch.object(notification, 'send_telegram', return_value=True) as telegram, \
             patch.object(notification, 'send_zalo', return_value=True) as zalo, \
             patch.object(notification.time, 'monotonic', return_value=100) as now:
            for timestamp, expected in ((100, 'sent'), (114.999, 'cooldown'), (115, 'sent')):
                now.return_value = timestamp
                result = notification.trigger_notifications('fire', .9, owner_user_id=1)
                for channel in ('telegram', 'zalo'):
                    self.assertEqual(result[channel]['status'], expected)
            self.assertEqual(telegram.call_count, 2)
            self.assertEqual(zalo.call_count, 2)

    def test_active_switch_and_cooldown_are_independent_between_accounts(self):
        first = targets.save_target('accounts', self.body, owner_user_id=1)
        targets.save_target('accounts', self.body, owner_user_id=2)
        with patch.object(notification, 'setting', side_effect=lambda k: 'token' if k.endswith('bot_token') else 'true'), \
             patch.object(notification, 'send_telegram', return_value=True):
            notification.last_notification.clear()
            self.addCleanup(notification.last_notification.clear)
            for owner in (1, 2):
                result = notification.trigger_notifications('fire', .9, channels=('telegram',), owner_user_id=owner)
                self.assertEqual(result['telegram']['status'], 'sent')
            self.body.active = False
            targets.save_target('accounts', self.body, first['id'], owner_user_id=1)
            self.assertEqual(notification.channel_config('telegram', 1)['targets'], [])
            self.assertEqual(len(notification.channel_config('telegram', 2)['targets']), 1)


if __name__ == '__main__':
    unittest.main()
