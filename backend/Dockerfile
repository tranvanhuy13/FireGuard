# check=skip=SecretsUsedInArgOrEnv
FROM python:3.12-slim

# OpenCV runtime libs (ultralytics pulls the non-headless opencv build)
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# CPU-only PyTorch first, so ultralytics doesn't pull the multi-GB CUDA build
RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV PYTHONUNBUFFERED=1 \
    DB_NAME=/data/fire_guard.db \
    AUTH_DB_PATH=/data/auth.db \
    MODEL_PATH=/data/models/best.pt \
    SNAPSHOT_DIR=/data/snapshots \
    YOLO_CONFIG_DIR=/tmp/ultralytics

EXPOSE 8000

# Render cap cong qua bien PORT; chay local khong co PORT thi dung 8000
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000} --log-level info"]