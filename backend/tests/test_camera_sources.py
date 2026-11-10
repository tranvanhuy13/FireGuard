"""Validate real sources without opening hardware, network or the application."""
import pytest
from pydantic import ValidationError
from camera_sources import CameraModel, normalize_source


@pytest.mark.parametrize('source', ['0', '1', '63', 'rtsp://camera.local/live',
                                 'rtsps://user:password@camera.local:322/live',
                                 'https://camera.local/live.m3u8?key=abc', 'http://192.168.1.4/mjpeg'])
def test_accept_supported_sources(source):
    assert CameraModel(name='Gate', source=source).source == source


@pytest.mark.parametrize('source', ['', '-1', '64', '/etc/passwd', 'file:///video.mp4',
                                 'C:\\video.mp4', 'ftp://camera/live', 'https://',
                                 'http://camera:99999/', 'http://camera/\r\nheader',
                                 'https://camera/live#fragment'])
def test_reject_unsupported_sources(source):
    with pytest.raises(ValidationError):
        CameraModel(name='Gate', source=source)


def test_normalizes_webcam_and_names():
    assert normalize_source(' 01 ') == '1'
    assert CameraModel(name=' Gate ').name == 'Gate'
    with pytest.raises(ValidationError):
        CameraModel(name=' ')
