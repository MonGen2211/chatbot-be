# Trạng thái, retry và edit

## Triển khai

Chạy `npm.cmd run db:migrate`, `npm.cmd run db:types`, restart backend. Migration 002 giữ message hiện có, thêm sequence_no để sắp xếp ổn định, generation_id để chặn worker cũ, is_edited/edited_at và bảng idempotency `app_private.chat_requests`. Không sửa migration 001 đã áp dụng.

Hợp đồng FE: [frontend-api.md](frontend-api.md). Chỉ backend được sửa; FE cần thêm message_id và xử lý các event/status mới.

## Database và concurrency

ChatRepository dùng transaction ngắn. SELECT conversation FOR UPDATE tuần tự hóa send/retry/edit/finalize theo conversation trên mọi backend instance. Advisory transaction lock theo user ID + client message ID xử lý send trùng ngay cả khi chưa có conversation. Không giữ transaction/connection khi gọi AI, chờ backoff hoặc streaming.

- Send: kiểm tra idempotency trước kiểm tra unresolved; tạo user completed và assistant pending trong cùng transaction. User ID lấy từ JWT.
- Replay: trả record hiện có, không gọi AI lại. Ledger riêng giữ tombstone cả khi message bị edit xóa, tránh hồi sinh request cũ. Cùng ID nhưng payload khác trả 409.
- Retry user bấm: lock conversation, kiểm tra đúng owner/role/status failed; đổi chính assistant sang pending, cấp generation_id mới. Request thứ hai thấy pending/completed sẽ trả 409.
- Edit: lock conversation, kiểm tra user message, xóa sequence_no lớn hơn trong cùng conversation, cập nhật nội dung và dấu chỉnh sửa, tạo assistant mới. Tất cả commit/rollback cùng nhau; AI gọi sau commit.
- Finish: chỉ update nếu assistant còn tồn tại, đúng generation_id, còn pending và parent user còn tồn tại. Edit xóa record hoặc retry đổi token khiến kết quả cũ không ghi được. Response stream cũ kết thúc superseded.

Một heartbeat mỗi 20s giữ lease của tác vụ còn chạy. Pending không có heartbeat hơn 2 phút được chuyển failed khi send/retry/finalize hoặc GET messages truy cập. Lease đã hết không được worker cũ gia hạn/hồi sinh. Thời gian dựa trên clock PostgreSQL. Tắt client/abort trong luồng bình thường sẽ cố lưu failed ngay; nếu process chết hoặc DB mất kết nối, lần truy cập sau chạy stale recovery.

Context chỉ lấy completed trước user message hiện tại, tối đa 40 messages/48000 ký tự. Loại pending/failed và không đưa user hiện tại vào lịch sử hai lần. Thứ tự dựa sequence_no thay vì timestamp có thể trùng.

## AI retry và stream

Gemini đang dùng fetch, không có SDK maxRetries. Retry helper độc lập không thao tác database. Tối đa 3 retries sau request ban đầu, timeout 30s/attempt. Các mã HTTP retry: 429,500,502,503,529; HTTP 400/401/403/404 và các mã không có trong allowlist không retry. Network/attempt timeout retry; abort từ client không retry. JSON lỗi, safety block, output rỗng/truncated không tự coi là lỗi mạng; EOF thiếu finish được coi stream bị gián đoạn và retry.

Backoff cơ sở 500ms,1000ms,2000ms + jitter 0–25%; cap 8000ms. Retry-After hỗ trợ số giây hoặc HTTP date, ưu tiên so với jitter và cũng cap 8s. Deadline của toàn bộ HTTP stream là 180s; mỗi truy vấn SQL có timeout riêng.

Nếu attempt trước đã phát delta, reset thông báo FE xóa text tạm. Các phần text từ attempt thất bại không được nối vào kết quả attempt sau. Sau khi hết retries/lỗi không retry được, assistant chuyển failed với content rỗng và error_text chung; user giữ lại. Done trả success=true cho cả completed/failed/replay pending; lỗi provider không bị đưa ra client.

## Kiểm tra

`npm.cmd test`: unit tests retry/backoff/timeout/Retry-After, service send/retry/edit và HTTP Gemini mock. Không gọi Google thật.

Kiểm tra PostgreSQL thật (cần .env hợp lệ):

```powershell
$env:RUN_PG_INTEGRATION='1'
node --test tests/chat-postgres.test.cjs
```

Integration test tạo schema `chat_verify_<UUID>` riêng, mock AI, kiểm tra migration/transaction/ownership/replay/bấm đúp/edit/stale/fencing rồi xóa schema test trong finally. Không sửa record chat của user. Mặc định integration test được skip khi chạy npm test.
