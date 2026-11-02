# Chat backend

Xem [frontend-api.md](frontend-api.md) để tích hợp FE và [chat-operations.md](chat-operations.md) để hiểu retry, trạng thái, transaction và edit.

Các API có Bearer token:

- GET `/api/conversations?limit=50&offset=0` — conversation của user.
- GET `/api/messages?conversation_id=UUID&limit=50&offset=0` — history, cũ trước mới sau.
- POST `/api/chat` — `{ "message_id": "UUID-client-tao", "message": "...", "conversation_id": "UUID-neu-chat-tiep" }`.
- POST `/api/chat/messages/:assistant_message_id/retry` — thử lại assistant failed trên cùng record, không cần body.
- PATCH `/api/chat/messages/:user_message_id` — `{ "message": "Nội dung đã sửa" }`, xóa phần phía sau và tạo assistant mới.

POST send/retry và PATCH edit cùng trả SSE. Event conversation chứa user/assistant đã lưu và deleted_message_ids. Delta chứa text, reset yêu cầu xóa text tạm khi tự retry, done chứa message completed/failed và user_message. Superseded báo stream đã bị edit/retry thay thế. Lỗi AI cuối cùng trả done success=true/status=failed, không trả lỗi gốc. Lỗi quyền/input/conflict trước stream vẫn trả 4xx, lỗi database không được xem là lỗi AI đã xử lý.

FE phải giữ nguyên message_id khi gửi lại cùng request và xử lý status/reset/superseded. Các URL legacy vẫn tồn tại nhưng hợp đồng send có thêm message_id bắt buộc. Không tự gửi POST mới để retry assistant failed; dùng endpoint retry. Khi edit, hủy stream cũ và xóa các ID được backend trả về.

Backend dùng Gemini streaming, prompt `src/config/chat-prompt.ts`, tối đa 40 completed messages/48000 ký tự context. Key/model nằm trong backend .env. Chat mới tự tạo conversation; không cần gọi thêm create API.
