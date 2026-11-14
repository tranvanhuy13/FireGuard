# Thu nghiem Seawsurf tren camera va video

Nhanh: `feat/retrain-ai-model`.

`backend/best.pt` hien la Seawsurf YOLO26n, hai lop `fire` va `smoke`.
SHA256: `d2b0be214f45fa01d2044b960c3cb4da4bf65c06a89cf0a1967b0d40e8db4b98`.
Nguon: https://huggingface.co/seawsurf/fire_yolo

Ban v2 cu duoc giu tai:
`D:/python/FireGuard/model-candidates/seawsurf-fire-yolo/best.before-seawsurf-20261112-205352.pt`.

## Cach thu

1. Khoi dong lai backend dang chay de nap weight moi. Tu thu muc backend, dung moi truong hien co:
   `.\venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000`.
2. Cau hinh local hien dung `MODEL_PATH=best.pt`. Neu shell co MODEL_PATH khac, xoa override do truoc khi khoi dong.
3. Tren giao dien FireGuard, mo Analyze Video, chon Upload and play, bat dau voi 5 detection updates/second.
4. Video mau nam ngoai repository tai `D:/python/FireGuard/model-candidates/seawsurf-fire-yolo/manual-test-videos`:
   - `fire.mp4`: video mau lua.
   - `small_fire.mp4`: video mau lua nho.
   - `smoke.mp4`: video mau khoi.
5. Kiem tra box, nhan fire/smoke, do tre xac nhan, va ket qua thong bao tren giao dien. Video co the kich hoat bot da cau hinh. Viec thu video khong thay the thu nguon camera/RTSP that.
6. Voi camera, bat nguon camera hien co va theo doi hinh, nhan va thong bao. Khong dung video file lam camera source; upload qua Analyze Video.

Nguon video: https://github.com/punpayut/Fire-Detection . File LICENSE va metadata nguon duoc luu cung video. Day la mau kiem thu chuc nang, khong co ground-truth de tinh AP/Recall.

## Gioi han va quay lai v2

Seawsurf khong mac nhien tot hon v2: ket qua tren test FireGuard truoc do thap hon v2, trong khi tren bo CCTV tong hop lai cao hon. Chua doi threshold, persistence, cooldown hoac logic thong bao.

De quay lai v2, dung ban sao luu neu tren thay `backend/best.pt` va khoi dong lai backend. Chi doi ten nhanh Git khong tu dong phuc hoi thay doi weight chua commit.

Nhanh duoc tao tu origin/master; cac thay doi khong lien quan duoc giu trong working tree va khong dua vao PR. Chua deploy. Chi file weight va tai lieu thu nghiem/retraining thuoc pham vi PR.
