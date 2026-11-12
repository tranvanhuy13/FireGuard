"""No persisted camera pixels for opt-out accounts, without real storage or DB."""
import os
import time
from types import SimpleNamespace
from unittest.mock import Mock, patch

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
        assert storage.camera_snapshots_allowed(9, 'video')
    with patch('db.engine.read_rows', return_value=[]):
        assert storage.camera_snapshots_allowed(8, 'camera')


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
