"""No persisted camera pixels for opt-out accounts, without real storage or DB."""
import os
import time
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch

from sqlalchemy.exc import OperationalError
import storage


def test_policy_blocks_jpeg_local_remote_and_registry():
    with patch('db.engine.read_rows', return_value=[{'value': 'false'}]), \
         patch.object(storage.cv2, 'imencode') as encode, \
         patch.object(storage, '_write_local') as local, \
         patch.object(storage, '_get_store') as remote, \
         patch('evidence.register') as register:
        assert storage.save_snapshot('private.jpg', object(), keep_local=True,
                                     owner_user_id=9, source_kind='camera', source_id=1) is None
    encode.assert_not_called()
    local.assert_not_called()
    remote.assert_not_called()
    register.assert_not_called()


def test_policy_failure_is_closed_and_other_sources_keep_existing_policy():
    with patch('db.engine.read_rows', side_effect=OperationalError('read', {}, Exception('offline'))):
        assert not storage.camera_snapshots_allowed(9, 'camera')
        assert not storage.camera_snapshots_allowed(9, 'video')
    with patch('db.engine.read_rows', return_value=[]):
        assert storage.camera_snapshots_allowed(8, 'camera')


def test_global_policy_and_legacy_camera_policy_are_distinct():
    def legacy_only(sql, args):
        return [{'value': 'false'}] if args[0] == 'camera_snapshots_enabled_user_9' else []
    with patch('db.engine.read_rows', side_effect=legacy_only):
        assert not storage.camera_snapshots_allowed(9, 'camera')
        assert storage.camera_snapshots_allowed(9, 'video')
    with patch('db.engine.read_rows', return_value=[{'value': 'false'}]):
        assert not storage.camera_snapshots_allowed(9, 'camera')
        assert not storage.camera_snapshots_allowed(9, 'video')


def test_video_opt_out_blocks_storage_before_encoding():
    with patch('db.engine.read_rows', return_value=[{'value': 'false'}]), \
         patch.object(storage.cv2, 'imencode') as encode, \
         patch.object(storage, '_write_local') as local, \
         patch.object(storage, '_get_store') as remote, \
         patch('evidence.register') as register:
        assert storage.save_snapshot('video.jpg', object(), keep_local=True,
                                     owner_user_id=9, source_kind='video', source_id='job') is None
    encode.assert_not_called()
    local.assert_not_called()
    remote.assert_not_called()
    register.assert_not_called()


def test_background_sync_does_not_upload_disabled_account_images(tmp_path):
    image = tmp_path / 'old.jpg'
    image.write_bytes(b'fixture')
    os.utime(image, (time.time() - 120, time.time() - 120))
    with patch.object(storage, 'SNAPSHOT_DIR', str(tmp_path)), \
         patch.object(storage, '_stop', SimpleNamespace(is_set=lambda: False)), \
         patch('evidence.find', return_value={'owner_user_id': 9, 'source_kind': 'camera'}), \
         patch('db.engine.read_rows', return_value=[{'value': 'false'}]), \
         patch.object(storage, '_get_store') as remote:
        storage._sync_pending()
    remote.assert_not_called()


def test_disabled_camera_event_still_sends_text_without_snapshot():
    from tests.test_camera_lifecycle import cm
    camera = SimpleNamespace(id=1, name='Test', owner_user_id=9,
                             last_detection_log_time={}, evidence_scope=lambda: {})
    manager = cm.CameraManager.__new__(cm.CameraManager)
    manager.alert_callback = Mock()
    db = Mock()
    db.add_event.return_value = (1, 'now')
    with patch.object(cm.storage, 'camera_snapshots_allowed', return_value=False), \
         patch.object(cm.storage, 'save_snapshot') as save, \
         patch.object(cm.storage, 'discard_local') as discard, \
         patch.object(cm.notification, 'trigger_notifications') as notify, \
         patch.dict('sys.modules', {'database': db}), \
         patch.object(cm.threading, 'Thread') as worker:
        manager._save_event(camera, 'fire', .9, object())
        worker.call_args.kwargs['target']()
    save.assert_not_called()
    discard.assert_not_called()
    assert db.add_event.call_args.args[2] is None
    assert manager.alert_callback.call_args.args[0]['snapshot'] is None
    assert notify.call_args.args[2] is None
    assert notify.call_args.kwargs['owner_user_id'] == 9


def test_existing_account_opt_out_does_not_change_credentials():
    from scripts.provision_camera_test_account import disable_images
    conn = MagicMock()
    conn.execute.return_value.fetchone.return_value = {'id': 43}
    with patch('scripts.provision_camera_test_account.get_connection') as connect:
        connect.return_value.__enter__.return_value = conn
        assert disable_images('camtest') == 43
    writes = conn.execute.call_args_list[1:]
    assert len(writes) == 2
    assert {call.args[1][0] for call in writes} == {
        'snapshots_enabled_user_43', 'camera_snapshots_enabled_user_43'}
    assert all('INSERT INTO settings' in call.args[0] for call in writes)


def test_missing_account_opt_out_makes_no_writes():
    import pytest
    from scripts.provision_camera_test_account import disable_images
    conn = MagicMock()
    conn.execute.return_value.fetchone.return_value = None
    with patch('scripts.provision_camera_test_account.get_connection') as connect:
        connect.return_value.__enter__.return_value = conn
        with pytest.raises(ValueError, match='Account not found'):
            disable_images('missing')
    assert conn.execute.call_count == 1
