"""Request models for uploaded-video controls."""
from typing import Literal
from pydantic import BaseModel


class PlaybackControl(BaseModel):
    action: Literal["pause", "resume", "restart"]

class RetryVideoNotification(BaseModel):
    event_type: Literal["fire", "smoke"]
    channel: Literal["zalo", "telegram"]
