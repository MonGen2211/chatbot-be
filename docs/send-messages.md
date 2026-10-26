# Send messages với Gemini streaming

## Cấu hình

Trong `ai-chat-be/.env`, điền key lấy từ Google AI Studio:

```env
GEMINI_API_KEY=your-google-ai-studio-key
GEMINI_MODEL=gemini-3.1-flash-lite
```

Model có thể đổi theo quyền truy cập của project Google. Key chỉ nằm ở backend. Route không sử dụng key `VITE_GEMINI_API_KEY` của FE. Dừng và chạy lại `npm.cmd run dev` sau khi sửa `.env`.

Backend gọi REST `streamGenerateContent?alt=sse` theo [Gemini API](https://ai.google.dev/api/generate-content); không cần cài thêm SDK. Route auth vẫn chạy khi chưa điền Gemini key; route chat trả 503 nếu thiếu key.

## Request

```http
POST /api/conversations/send-messages
Authorization: Bearer <access_token từ API login>
Content-Type: application/json
```

Chat mới, không gửi ID hoặc gửi `null`:

```json
{
  "message": "Xin chào, giới thiệu bản thân nhé!"
}
```

Backend tạo conversation với `user_id` lấy từ token, lưu tin nhắn user và trả ID trong event đầu tiên. FE phải giữ ID này và gửi lại ở lượt tiếp theo:

```json
{
  "conversation_id": "UUID nhận từ event conversation",
  "message": "Bạn có thể giúp mình học TypeScript không?"
}
```

`conservation_id` được chấp nhận như alias cho `conversation_id`. Nếu ID được gửi nhưng không tồn tại/không thuộc user, trả **404**, không tự tạo conversation khác. Không gửi ID mock như `conversation-1`; ID thật là UUID từ backend. Không gửi `user_id`, role hay lịch sử từ FE: backend tự xác minh chủ sở hữu và đọc lịch sử từ database.

Message từ 1 đến 12000 ký tự, không chỉ khoảng trắng. Body giới hạn 64 KiB. Route dùng 40 tin nhắn hoàn tất gần nhất, tối đa 48000 ký tự lịch sử, và thêm tin nhắn hiện tại làm context cho Gemini.

## Lấy danh sách conversation và messages

Cả hai API GET trả JSON và yêu cầu `Authorization: Bearer <access_token>` giống send-messages. Không cần Gemini key để gọi hai API này.

**GET `/api/conversations?limit=50&offset=0`** lấy conversation theo `user_id` của người đăng nhập, mới cập nhật nhất trước. FE không cần truyền `user_id`; backend lấy ID đã xác minh từ token và không dùng user ID trong query/body để quyết định chủ sở hữu.

```json
{
  "success": true,
  "data": {
    "conversations": [],
    "pagination": { "limit": 50, "offset": 0, "has_more": false }
  }
}
```

Mỗi conversation có `id`, `user_id`, `title`, `model`, `created_at`, `updated_at`, `last_message_at`.

**GET `/api/conversations/<conversation_id>/messages?limit=50&offset=0`** lấy messages của conversation, cũ trước mới sau. Backend kiểm tra chủ sở hữu trước khi đọc messages; ID không tồn tại hoặc thuộc người khác trả 404. UUID sai định dạng trả 400.

```json
{
  "success": true,
  "data": {
    "conversation_id": "UUID-cua-conversation",
    "messages": [],
    "pagination": { "limit": 50, "offset": 0, "has_more": false }
  }
}
```

Mỗi message có `id`, `conversation_id`, `parent_message_id`, `role`, `content`, `status`, `provider`, `model`, `created_at`, `updated_at`. API này lấy lịch sử đã lưu để FE hiển thị, không áp dụng giới hạn context 40 tin/48000 ký tự của lời gọi Gemini.

Mặc định `limit=50`, tối đa 100, `offset` từ 0 đến 1000000. `has_more=true` thì gọi trang tiếp với `offset` tăng thêm `limit`. Danh sách trống trả 200 với mảng rỗng. Token thiếu/sai trả 401. Trong Postman chọn GET, URL như trên, Authorization → Bearer Token, không cần body.

## Chi tiết response SSE của send-messages

Request hợp lệ bắt đầu trả HTTP **200** với `Content-Type: text/event-stream`. Mỗi event kết thúc bằng một dòng trống. Ví dụ:

```text
event: conversation
data: {"conversation_id":"uuid","created":true,"user_message_id":"uuid"}

event: delta
data: {"text":"Xin chào! "}

event: delta
data: {"text":"Mình có thể giúp bạn."}

event: done
data: {"conversation_id":"uuid","message":{"id":"uuid","conversation_id":"uuid","role":"assistant","content":"Xin chào! Mình có thể giúp bạn.","created_at":"..."}}

```

- `conversation`: FE giữ ID để dùng lại; `created` cho biết vừa tạo mới hay dùng lại. Tin nhắn user đã được lưu trước event này.
- `delta`: nối `text` vào câu trả lời đang hiển thị.
- `done`: câu trả lời đã hoàn tất và được lưu trong `messages`; giữ ID message để thay thế bản tạm trên giao diện.
- `error`: lỗi xảy ra sau khi stream bắt đầu, ví dụ quota, timeout hoặc lỗi lưu database. Không coi HTTP 200 là thành công hoàn chỉnh; phải nhận `done`.

```text
event: error
data: {"success":false,"code":"gemini_rate_limited","message":"Gemini đã hết quota hoặc đang giới hạn yêu cầu."}

```

Nếu lỗi xảy ra trước khi stream bắt đầu, API trả HTTP status + JSON theo middleware hiện có: 400 (input), 401 (token), 404 (conversation), 409 (đang xử lý lượt khác), 503 (config/database). Một khi đã bắt đầu SSE thì HTTP status không đổi được; FE cần xử lý event `error`.

## Test bằng cURL/Postman

Đăng nhập trước để lấy `data.session.access_token`. PowerShell dùng `curl.exe`, thay token thật ở máy bạn:

```powershell
curl.exe -N -X POST 'http://localhost:3001/api/conversations/send-messages' `
  -H 'Authorization: Bearer YOUR_ACCESS_TOKEN' `
  -H 'Content-Type: application/json' `
  --data-raw '{"message":"Xin chào!"}'
```

Trong Postman: POST cùng URL, Authorization → Bearer Token, Body → raw → JSON như trên. Đọc các event trong response. Để kiểm tra dùng lại conversation, gửi request tiếp theo với UUID nhận từ event `conversation`.

## Gọi từ FE bằng fetch

SSE ở route POST này cần `fetch()` + `response.body`; không dùng `EventSource` vì nó không gửi được POST body/Bearer header theo cách này. Đoạn dưới minh họa cách đọc các frame có thể bị tách qua nhiều network chunk:

```ts
async function sendMessage(
  token: string,
  message: string,
  conversationId: string | undefined,
  onEvent: (event: string, data: any) => void,
  signal?: AbortSignal,
) {
  const response = await fetch('http://localhost:3001/api/conversations/send-messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message, conversation_id: conversationId }),
    signal,
  });
  if (!response.ok) throw await response.json();
  if (!response.body) throw new Error('Không có response stream');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completed = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const lines = frame.split('\n');
        const event = lines.find(line => line.startsWith('event: '))?.slice(7);
        const raw = lines.find(line => line.startsWith('data: '))?.slice(6);
        if (!event || !raw) continue;
        const data = JSON.parse(raw);
        if (event === 'error') throw data;
        if (event === 'done') completed = true;
        onEvent(event, data);
      }
      if (done) break;
    }
    if (!completed) throw new Error('Kết nối ngắt trước khi câu trả lời hoàn tất');
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
```

Trong `onEvent`, lưu `data.conversation_id` khi nhận `conversation`, nối `data.text` khi nhận `delta`, và dùng `data.message` khi nhận `done`. Dùng `AbortController` để làm nút dừng. Đây là hướng dẫn tích hợp; code FE hiện tại chưa được thay đổi.

## Database và xử lý khi lỗi

Route dùng các bảng hiện có:

- `conversations`: `id`, `user_id`, `title`, `model`, `updated_at`, `last_message_at`.
- `messages`: `id`, `conversation_id`, `parent_message_id`, `role`, `content`, `status`, `provider`, `model`, `response_id`, `input_tokens`, `output_tokens`, `created_at`.

`conversations.user_id` tham chiếu `profiles.id`, nên user đăng nhập phải có profile tương ứng (thường do trigger đăng ký tạo). Backend xác minh Bearer token với Supabase Auth để lấy user ID. Khi `.env` có `SUPABASE_SECRET_KEY`, truy vấn chat dùng client backend riêng với key này, không gắn token user vào client database. Backend gắn `user_id` từ token khi tạo conversation và kiểm tra `id` + `user_id` trước khi đọc lịch sử hoặc thêm message vào conversation hiện có. FE không được quyết định chủ sở hữu. Không có tính năng phân vai admin/user.

Secret key chỉ ở server và có thể bỏ qua RLS, nên các bước kiểm tra chủ sở hữu trong backend là bắt buộc. Route không thay đổi GRANT hoặc RLS trên Supabase. Nếu không có secret key, client dùng token user và quyền/RLS của user vẫn áp dụng. Với RLS đang tắt, quyền truy cập trực tiếp qua Data API phụ thuộc GRANT của từng role; kiểm tra chủ sở hữu trong backend chỉ bảo vệ các request đi qua backend.

Tin nhắn user lưu với `status = completed`. Câu trả lời assistant chỉ lưu khi Gemini kết thúc với `STOP`, kèm `parent_message_id` trỏ tới tin nhắn user, provider `google`, model, response ID và token usage nếu có. Không lưu suy nghĩ nội bộ (thought parts).

Nếu Gemini lỗi, bị chặn, stream bị ngắt, đạt giới hạn output hoặc FE đóng kết nối, conversation và tin nhắn user đã lưu được giữ lại; câu trả lời dở dang không được lưu thành completed. Nếu FE đã có text tạm, hiển thị trạng thái bị ngắt khi nhận error/mất kết nối. Nếu database lỗi sau khi lưu assistant nhưng trước khi cập nhật timestamp, có thể đã có assistant trong DB dù FE nhận error. Route không có idempotency key; tự gửi lại request sẽ tạo thêm tin nhắn user.

Giới hạn: timeout mỗi lượt 120 giây, output tối đa 8192 token/100000 ký tự. Mỗi conversation chỉ xử lý một lượt tại một thời điểm trong cùng process (lượt chồng trả 409). Nếu triển khai nhiều backend instance cần lock phân tán hoặc transaction/RPC để giữ thứ tự xuyên instance. Chưa có queue hoặc tự retry request có thể phát sinh chi phí Gemini.

`npm.cmd test` chạy mock Supabase/Gemini, không ghi dữ liệu lên project thật hoặc gọi Google thật.
