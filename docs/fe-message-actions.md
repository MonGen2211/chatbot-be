# 4 API thao tác conversation/message cho FE

Base URL: `http://localhost:3001`. Tất cả cần `Authorization: Bearer <access_token>`. Có JSON body thì thêm `Content-Type: application/json`. Không gửi user_id; ID lấy từ tài nguyên hiện có. Sai UUID trả 400, sai quyền/không tồn tại trả 404.

## 1. Rename conversation

**PATCH `/api/conversations/:conversation_id`**

Body: `{ "title": "Học Node.js" }`. Title trim, bắt buộc 1–200 ký tự.

HTTP 200 JSON: `{ "success": true, "data": { "conversation": { "id": "...", "title": "Học Node.js" } } }`.

Conversation trả đủ metadata: id, user_id, title, model, created_at, updated_at, last_message_at. FE cập nhật title/sidebar từ response.

## 2. Delete conversation kèm toàn bộ messages

**DELETE `/api/conversations/:conversation_id`**, không cần body.

HTTP 200 JSON:

```json
{
  "success": true,
  "data": { "conversation_id": "...", "deleted_message_ids": ["..."] }
}
```

Xóa mọi messages của conversation, kể cả pending/failed/completed, rồi xóa conversation trong cùng transaction. FE hủy stream liên quan, xóa conversation/sidebar/cache. Nếu đang mở conversation này thì chuyển sang New Chat hoặc conversation khác. AI về muộn không tạo lại dữ liệu. Xóa lại ID đã mất trả 404.

## 3. Retry assistant failed

**POST `/api/chat/messages/:assistant_message_id/retry`**, không cần body.

Chỉ assistant failed được retry, cập nhật cùng record: failed → pending → completed/failed. Không tạo message mới. Hai request đồng thời chỉ một chạy, request còn lại 409. Sai role/status trả 409.

Response HTTP 200 **SSE** theo phần dưới. FE giữ nguyên assistant ID, xóa text cũ và hiện pending/loading.

## 4. Edit user message

**PATCH `/api/chat/messages/:user_message_id`**

Body: `{ "message": "Nội dung đã chỉnh sửa" }`. Chỉ sửa tin user, không rỗng/chỉ khoảng trắng, tối đa 12000 ký tự.

Backend transaction: sửa user gốc, is_edited=true/edited_at; xóa mọi tin phía sau; tạo assistant pending mới. Sau commit mới gọi AI. `U1-A1-U2-A2`, sửa U1 thì còn U1 đã sửa và assistant mới, không tạo phiên bản/nhánh.

Response HTTP 200 **SSE**. FE cập nhật user_message, xóa deleted_message_ids và tạo placeholder bằng assistant_message mới. Không gọi thêm API delete/create.

## SSE chung cho retry/edit

```text
event: conversation
data: {"conversation_id":"...","created":false,"user_message_id":"...","user_message":{"id":"...","content":"...","is_edited":true},"assistant_message":{"id":"...","status":"pending","content":""},"deleted_message_ids":[],"replayed":false}

event: delta
data: {"text":"Một đoạn text"}

event: reset
data: {"assistant_message_id":"...","attempt":2}

event: done
data: {"success":true,"conversation_id":"...","user_message":{"id":"...","content":"..."},"message":{"id":"...","status":"completed","content":"Toàn bộ câu trả lời"},"deleted_message_ids":[],"replayed":false}

```

- conversation: DB đã commit; cập nhật user/assistant/deleted IDs ngay.
- delta: nối text vào assistant của request này.
- reset: AI tự retry; xóa text assistant tạm trước khi nối lại, giữ nguyên ID.
- done: thay placeholder bằng data.message, kết thúc loading. Kiểm tra status: failed vẫn success=true, user message vẫn được giữ; hiện nút retry. Không xem mọi HTTP 200/done là AI thành công.
- superseded (`assistant_message_id`): stream cũ đã bị edit/delete/retry thay thế; không chèn lại tin đã xóa.
- error (`code`, `message`): lỗi hệ thống/database sau khi SSE bắt đầu. Lỗi trước stream trả HTTP status + JSON.

Dùng fetch + response.body + TextDecoder streaming và buffer SSE. Khi edit/delete, abort stream cũ liên quan để delta cũ không cập nhật UI mới. Không dùng EventSource cho POST/PATCH có body/Bearer.

Lỗi chung: `{ "success": false, "message": "...", "code": "..." }`. 400 input/role sai; 401 token sai/hết hạn; 404 sai quyền/không tồn tại; 409 không retry được/đang xử lý; 5xx lỗi hệ thống/database. Khi lỗi mạng sau delete, reload danh sách/history để đồng bộ, không tự tạo lại record.
