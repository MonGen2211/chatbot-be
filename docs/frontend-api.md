# Mô tả API gửi cho FE

Base URL: `http://localhost:3001`. Đăng ký/đăng nhập nhận JSON; GET nhận JSON; gửi chat nhận SSE streaming. Không gọi Gemini trực tiếp từ FE.

## Auth

- `POST /api/auth/register`: body `{ "email": "...", "password": "..." }`, thành công 201. Password tối thiểu 8 ký tự, tối đa 72 byte UTF-8. Đăng ký mới có session ngay, không cần xác nhận email.
- `POST /api/auth/login`: cùng dạng body, thành công 200.

Response cả hai có `success: true`, `data.user` (`id`, `email`) và `data.session` (`access_token`, `token_type`, `expires_in`, `expires_at`). FE lưu user/token. JWT do backend cấp; không dùng token Supabase cũ. Chưa có refresh/logout API: token hết hạn thì đăng nhập lại, logout FE xóa session.

Tất cả API dưới đây yêu cầu `Authorization: Bearer <access_token>`. POST thêm `Content-Type: application/json`. Không gửi user ID; backend lấy từ token.

## Conversation — danh sách cuộc trò chuyện

`GET /api/conversations?limit=50&offset=0`

Trả `data.conversations` là mảng của user đăng nhập, mới cập nhật trước. Mỗi item có `id`, `user_id`, `title`, `model`, `created_at`, `updated_at`, `last_message_at`.

## Message — lịch sử tin nhắn

`GET /api/messages?conversation_id=<UUID>&limit=50&offset=0`

Trả `data.conversation_id`, `data.messages` cũ trước mới sau. Mỗi message có `id`, `conversation_id`, `parent_message_id`, `role`, `content`, `status`, `provider`, `model`, `created_at`, `updated_at`.

Cả hai GET có `data.pagination = { limit, offset, has_more }`. Mặc định limit 50, tối đa 100. Khi has_more=true, tăng offset thêm limit. Mảng rỗng là kết quả hợp lệ. Conversation không tồn tại/không thuộc user trả 404.

## Chat — gửi tin, gọi AI và streaming

`POST /api/chat`

Chat mới: `{ "message": "Giải thích middleware Node.js" }`.

Chat tiếp: `{ "conversation_id": "UUID-thật-từ-backend", "message": "Cho mình ví dụ" }`.

Chưa có ID hoặc ID null thì backend tự tạo conversation. FE không gửi ID tạm/mock. Message từ 1 đến 12000 ký tự, không chỉ khoảng trắng. Backend tự lấy lịch sử; FE không gửi mảng message cũ. Chat tự lưu user message, gọi Gemini, stream và lưu assistant khi hoàn tất. Không cần gọi thêm API tạo message/conversation trước hoặc sau.

Dùng fetch + response.body + TextDecoder streaming, giữ buffer để ghép các frame SSE bị tách qua nhiều network chunk:

```text
event: conversation
data: {"conversation_id":"...","created":true,"user_message_id":"..."}

event: delta
data: {"text":"Một đoạn câu trả lời"}

event: done
data: {"conversation_id":"...","message":{"id":"...","conversation_id":"...","role":"assistant","content":"Toàn bộ câu trả lời","created_at":"..."}}

event: error
data: {"success":false,"code":"...","message":"..."}

```

- conversation: lưu UUID thật, cập nhật active conversation/sidebar.
- delta: nối data.text vào assistant message tạm.
- done: thay message tạm bằng data.message đã lưu; kết thúc loading.
- error hoặc mất kết nối trước done: hiển thị trạng thái lỗi/gián đoạn, kết thúc loading.
- HTTP 200 chỉ cho biết SSE đã bắt đầu; phải nhận done mới hoàn tất.
- Stop: dùng AbortController. Chưa có retry/continue endpoint; đừng tự coi gửi lại là retry vì sẽ thêm user message mới.

## Tương thích URL cũ

- `GET /api/conversations/:conversation_id/messages` tương đương API Message mới.
- `POST /api/conversations/send-messages` tương đương API Chat mới.

FE đang dùng URL cũ vẫn chạy; response và SSE event giữ nguyên. Hiện chưa có API đổi tên/xóa conversation hoặc sửa/xóa message.

## Lỗi

Lỗi trước stream: JSON `{ "success": false, "message": "...", "code": "..." }`. Sau khi stream bắt đầu: event error, không đổi được HTTP status.

400: input sai; 401: sai thông tin đăng nhập/token hết hạn; 403: tài khoản/quyền database; 404: conversation không có quyền; 409: email trùng/conversation đang xử lý; 429: giới hạn request/quota; 502/503/504: lỗi upstream/database/timeout.

`gemini_unavailable` nghĩa là Google đang quá tải hoặc tạm thời không khả dụng, không đồng nghĩa API key sai. Hiển thị message và cho phép user thử lại sau. Backend không tự retry; gửi lại sẽ thêm một user message mới. `gemini_permission_denied`, `gemini_model_not_found`, `gemini_invalid_request` phân biệt lỗi key/quyền, model và cấu hình request.

Backend mặc định cho phép FE origin `http://localhost:5173`. Đổi CORS_ORIGIN ở backend nếu FE dùng origin khác.
