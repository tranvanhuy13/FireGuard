"""Camera input contract shared by HTTP validation and persisted-camera loading."""
from urllib.parse import urlsplit

from pydantic import BaseModel, Field, field_validator


def normalize_source(value: str) -> str:
    source = str(value).strip()
    if source.isascii() and source.isdecimal() and 0 <= int(source) <= 63:
        return str(int(source))
    try:
        url = urlsplit(source)
        valid = (url.scheme in {"rtsp", "rtsps", "http", "https"} and url.hostname
                 and not url.fragment and len(source) <= 2048
                 and not any(char.isspace() or ord(char) < 32 for char in source))
        # Accessing port also rejects malformed/out-of-range port numbers.
        url.port
    except ValueError:
        valid = False
    if not valid:
        raise ValueError("Use a webcam index (0–63) or an RTSP/HTTP(S) camera URL")
    return source


class CameraModel(BaseModel):
    source: str = Field(default="0", max_length=2048)
    name: str = Field(min_length=1, max_length=255)
    is_active: bool = False

    @field_validator("source")
    @classmethod
    def validate_source(cls, value):
        return normalize_source(value)

    @field_validator("name")
    @classmethod
    def validate_name(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("Camera name is required")
        return value
