export const getBackendUrl = () => {
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL.replace(/\/$/, "");
  }
  return "http://localhost:8000";
};

export const getWsUrl = () => {
  if (process.env.NEXT_PUBLIC_WS_URL) {
    return process.env.NEXT_PUBLIC_WS_URL.replace(/\/$/, "");
  }
  const api = getBackendUrl();
  return api.replace(/^http/, "ws");
};

export const API_URL = getBackendUrl();
export const WS_URL = getWsUrl();

// Hằng số xác thực OTP và mật khẩu
export const OTP_TTL_SECONDS = 120; // Yêu cầu mentor: 120s (backend hiện cấu hình 300s / 5 phút, cần đồng bộ)
export const OTP_RESEND_COOLDOWN_SECONDS = 60; // Đồng bộ backend (60 giây)
export const MIN_PASSWORD_LENGTH = 8; // Tạm thời theo yêu cầu của team (backend hiện là 6, chờ backend cập nhật lên 8)

