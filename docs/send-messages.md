# Chat API: PostgreSQL + local JWT + Gemini streaming

Base URL: `http://localhost:3001`. Cấu hình `DATABASE_URL`, chạy `npm.cmd run db:migrate` trước khi test. Xem [README](../README.md) về chuyển user cũ từ Supabase Auth và kết nối database.

## Đăng nhập

`POST /api/auth/login`, Body → raw → JSON:

```json
{ "email": "test@example.com", "password": "YourPassword123!" }
```

Copy `data.session.access_token`. Token hiện do backend ký, không dùng access token Supabase cũ. Nếu chưa có user, gọi `POST /api/auth/register` với cùng dạng body để tạo user/profile; mật khẩu tối thiểu 8 ký tự và tối đa 72 byte UTF-8. Đăng ký mới trả 201 với session, không có bước email confirmation. Session không có refresh token; token hết hạn thì đăng nhập lại.

## Header cho các API chat

```http
Authorization: Bearer <access_token>
Content-Type: application/json
```

User ID lấy từ JWT đã xác minh; FE không gửi `user_id`. Conversation không thuộc user hoặc không tồn tại trả 404; token sai/hết hạn trả 401.

## Gửi message

`POST /api/conversations/send-messages`

Chat mới:

```json
{ "message": "Giải thích middleware trong Node.js ngắn gọn nhé" }
```

Chat tiếp:

```json
{ "conversation_id": "UUID-tu-event-conversation", "message": "Cho mình ví dụ thực tế" }
```

Không có conversation ID hoặc gửi null thì tạo conversation thuộc user. ID có rồi thì kiểm tra chủ sở hữu và dùng lại. `conservation_id` vẫn được chấp nhận như alias. Message tối đa 12000 ký tự, không chỉ khoảng trắng; body tối đa 64 KiB.

Backend đọc tối đa 40 messages hoàn tất gần nhất/48000 ký tự, ghép message mới và gửi Gemini `streamGenerateContent?alt=sse`. Cấu hình `GEMINI_API_KEY` và `GEMINI_MODEL` trong `.env` backend. Mỗi lượt đều gửi prompt ở `src/config/chat-prompt.ts` qua `systemInstruction`. Prompt hiện giới hạn Next.js/Node.js, tiếng Việt/plain text và câu cảnh báo cuối; đây là hướng dẫn model, không bảo đảm tuân thủ tuyệt đối.

## Response SSE

```text
event: conversation
data: {"conversation_id":"uuid","created":true,"user_message_id":"uuid"}

event: delta
data: {"text":"Middleware là "}

event: delta
data: {"text":"hàm xử lý trong luồng request..."}

event: done
data: {"conversation_id":"uuid","message":{"id":"uuid","conversation_id":"uuid","role":"assistant","content":"...","created_at":"..."}}

```

- `conversation`: lưu ID để dùng lại. User message đã được lưu.
- `delta`: nối `data.text` vào câu trả lời tạm của UI.
- `done`: đã lưu assistant hoàn chỉnh, thay tin nhắn tạm bằng `data.message`.
- `error`: lỗi khi gọi Gemini hoặc lưu database, có `code`, `message`. HTTP 200 chưa có nghĩa hoàn tất; phải nhận `done`.

FE dùng `fetch()` đọc `response.body`, không dùng `EventSource` cho POST body/Bearer header. Giữ buffer để ghép frame SSE có thể bị chia qua nhiều network chunks và dùng TextDecoder streaming cho tiếng Việt. Dùng AbortController để làm nút Stop.

Lỗi trước stream trả JSON với HTTP status. Lỗi sau khi bắt đầu stream trả event `error`, ví dụ:

```text
event: error
data: {"success":false,"code":"gemini_rate_limited","message":"Gemini đã hết quota hoặc đang giới hạn yêu cầu."}

```

Conversation/user message đã lưu được giữ lại khi stream lỗi hoặc FE ngắt; không lưu câu trả lời dở dang thành completed. Nếu database lỗi sau khi lưu assistant nhưng trước cập nhật timestamp, assistant có thể đã có trong DB dù FE nhận error. Không có idempotency key; gửi lại sẽ thêm user message mới.

Timeout mỗi lượt 120 giây; mỗi truy vấn SQL tối đa khoảng 15 giây. Output tối đa 8192 token/100000 ký tự. Chỉ lưu assistant khi Gemini kết thúc `STOP`, cùng parent message ID, model, response ID/token usage nếu có; không lưu thought parts. Một lượt/conversation/process, gửi chồng trả 409; nhiều backend instance cần lock chia sẻ để bảo đảm thứ tự.

## Lấy conversation

`GET /api/conversations?limit=50&offset=0`, dùng Bearer token, không có body. Sắp xếp mới cập nhật trước.

```json
{
  "success": true,
  "data": {
    "conversations": [],
    "pagination": { "limit": 50, "offset": 0, "has_more": false }
  }
}
```

Conversation có `id`, `user_id`, `title`, `model`, `created_at`, `updated_at`, `last_message_at`.

## Lấy messages

`GET /api/conversations/<conversation_id>/messages?limit=50&offset=0`, Bearer token, không có body. Sắp xếp cũ trước mới sau.

```json
{
  "success": true,
  "data": {
    "conversation_id": "uuid",
    "messages": [],
    "pagination": { "limit": 50, "offset": 0, "has_more": false }
  }
}
```

Mỗi message có `id`, `conversation_id`, `parent_message_id`, `role`, `content`, `status`, `provider`, `model`, `created_at`, `updated_at`. Lịch sử hiển thị không bị giới hạn 40 tin như context cho Gemini. Mặc định limit 50, tối đa 100; offset từ 0 đến 1000000. Khi `has_more=true`, tăng offset thêm limit. Danh sách trống trả 200 với mảng rỗng.

## Database

Backend dùng `pg` kết nối trực tiếp PostgreSQL trên Supabase; mật khẩu nằm trong `DATABASE_URL`. Không gọi Supabase Auth, không dùng public/secret API key ở runtime. Các điều kiện user ID trong SQL bảo vệ conversation theo user; không cần phân vai admin/user. Dữ liệu auth/password hash nằm ở schema riêng `app_private`, không đặt ở các bảng public để tránh Data API đọc được.
