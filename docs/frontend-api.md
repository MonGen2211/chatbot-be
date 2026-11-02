# API backend cho FE

Base URL `http://localhost:3001`. JSON cho auth/GET, SSE cho send/retry/edit. Header chat/history: `Authorization: Bearer <access_token>`. POST/PATCH thêm `Content-Type: application/json`.

## Auth (không đổi)

- `POST /api/auth/register`: `{ "email": "...", "password": "..." }`, trả 201. Password tối thiểu 8 ký tự/tối đa 72 byte UTF-8.
- `POST /api/auth/login`: cùng dạng body, trả 200.
- Cả hai trả `data.user` (`id`, `email`) và `data.session` (`access_token`, `token_type`, `expires_in`, `expires_at`). Không có refresh/logout API; hết hạn thì đăng nhập lại. Logout FE xóa session. Không dùng token Supabase cũ.

## Danh sách chat/history

- `GET /api/conversations?limit=50&offset=0`: `data.conversations`, mới cập nhật trước.
- `GET /api/messages?conversation_id=UUID&limit=50&offset=0`: `data.messages`, cũ trước mới sau. Message có `id`, `role`, `content`, `status`, `parent_message_id`, `is_edited`, `edited_at`, timestamps và metadata model/provider.
- Hai GET có `data.pagination = { limit, offset, has_more }`, limit mặc định 50/tối đa 100. Tăng offset thêm limit để lấy tiếp.
- Message pending không có heartbeat hơn 2 phút được chuyển failed khi truy cập. FE có thể poll history để cập nhật một request trùng đang pending.

## Gửi tin — POST /api/chat

FE tạo UUID trước khi gửi, ví dụ `crypto.randomUUID()`, và giữ nguyên ID khi gửi lại cùng request do mất mạng:

```json
{
  "message_id": "UUID-cua-user-message-do-FE-tao",
  "message": "Giải thích middleware Node.js",
  "conversation_id": "UUID-conversation-neu-chat-tiep"
}
```

Bỏ conversation_id hoặc gửi null cho chat mới. Backend tự tạo conversation, lưu đúng một user + một assistant pending, lấy context, gọi Gemini và cập nhật assistant completed/failed. Message tối đa 12000 ký tự, không chỉ khoảng trắng. Không gửi user ID hoặc lịch sử từ FE.

Cùng message_id + cùng nội dung/conversation: trả lại cặp message đã có, `replayed=true`, không gọi AI lần hai. Nếu đang pending, response replay cũng có status pending; chờ/poll GET history, không tự tạo ID mới. Tái dùng ID cho nội dung/conversation khác trả 409. ID đã bị edit xóa không được dùng để tạo lại record.

Nếu có assistant pending hoặc failed trong conversation, gửi message mới trả 409. Với failed, dùng retry endpoint hoặc edit user message, không gọi POST /api/chat với ID mới để giả lập retry.

## Thử lại — POST /api/chat/messages/:assistant_message_id/retry

Không cần body. Chỉ chấp nhận assistant failed, update chính record đó sang pending rồi completed/failed. Không tạo thêm user/assistant record. Hai request đồng thời: một chạy, một trả 409. Sai quyền trả 404.

## Sửa — PATCH /api/chat/messages/:user_message_id

```json
{ "message": "Nội dung user đã sửa" }
```

Chỉ sửa user message đúng chủ sở hữu, không rỗng. Transaction sửa nội dung/đánh dấu edited, xóa toàn bộ messages phía sau (kể cả pending/failed) và tạo assistant pending mới. Sau commit mới gọi AI. Không tạo nhánh/phiên bản.

FE hủy stream cũ của conversation khi edit; dựa vào user_message, assistant_message và deleted_message_ids từ response để thay nội dung/xóa message cũ. Không cần tự gọi API delete/create thêm.

## SSE dùng chung cho send/retry/edit

```text
event: conversation
data: {"conversation_id":"...","created":false,"user_message_id":"...","user_message":{"id":"...","role":"user","content":"...","is_edited":false},"assistant_message":{"id":"...","role":"assistant","status":"pending","content":""},"deleted_message_ids":[],"replayed":false}

event: delta
data: {"text":"Một đoạn text"}

event: reset
data: {"assistant_message_id":"...","attempt":2}

event: done
data: {"success":true,"conversation_id":"...","user_message":{"id":"...","content":"..."},"message":{"id":"...","role":"assistant","status":"completed","content":"Toàn bộ câu trả lời"},"deleted_message_ids":[],"replayed":false}

```

- conversation: user/assistant đã được lưu; giữ ID thật, cập nhật sidebar và placeholder assistant theo ID.
- delta: nối text vào placeholder của request hiện tại.
- reset: một lần gọi AI bị lỗi giữa stream và được retry; xóa text assistant tạm trước khi nối lại, giữ nguyên ID.
- done: thay placeholder bằng data.message, kết thúc loading. **Phải kiểm tra status**: failed là lỗi AI đã xử lý thành công ở backend, user message vẫn còn; hiển thị nút retry. Replay có thể trả pending.
- superseded: `{ "assistant_message_id": "..." }` — kết quả của stream cũ đã bị thao tác edit/retry thay thế; dừng stream cũ, không chèn lại message đã bị xóa.
- error: `{ "success": false, "code": "...", "message": "..." }` dành cho lỗi hệ thống/database sau khi SSE bắt đầu. Lỗi quyền/input/conflict trước SSE trả HTTP status + JSON.

Khi AI lỗi hẳn, vẫn HTTP 200 và done với `success=true`, `message.status=failed`, content rỗng. Không trả stack trace/lỗi gốc provider. FE không được hiểu mọi done là AI trả lời thành công.

Dùng fetch + response.body + TextDecoder streaming, ghép buffer theo frame SSE. Stop dùng AbortController; backend đánh dấu assistant failed khi nhận ngắt kết nối. Server crash thì stale recovery xử lý sau 2 phút không heartbeat. Đừng cập nhật conversation mới bằng delta của stream cũ.

## Retry tự động

Backend thử lại tối đa 3 lần sau lần đầu (tổng tối đa 4 cuộc gọi), timeout 30s mỗi lần. Chờ 0.5s → 1s → 2s cộng jitter, ưu tiên Retry-After, cap 8s. Chỉ retry timeout/mạng/429/500/502/503/529, không retry 400/401/403/404 (429 là ngoại lệ 4xx). Không tạo DB record khi retry tự động.

## Tương thích và lỗi

API quản lý: PATCH `/api/conversations/:conversation_id` với body `{ "title": "Tên mới" }`; DELETE `/api/conversations/:conversation_id` xóa cả conversation và messages. Cả hai trả JSON 200. Không có API xóa message riêng. Mô tả đủ 4 API rename/delete conversation/retry/edit: [fe-message-actions.md](fe-message-actions.md).

URL cũ GET `/api/conversations/:conversation_id/messages` và POST `/api/conversations/send-messages` vẫn có; POST cũng cần message_id và dùng SSE/status mới. Auth/history URL không đổi. Chưa có continue hoặc phân nhánh.

400 input/role sai; 401 token/credentials; 404 không có quyền hoặc message/conversation không tồn tại; 409 chưa giải quyết pending/failed, double retry, ID conflict hoặc thao tác đã bị thay thế. Lỗi database vẫn có thể trả 5xx; cam kết response thành công cho lỗi AI không bao gồm lỗi không lưu được database.
