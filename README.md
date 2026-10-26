# AI Chat Backend

Backend Express + TypeScript, có **POST /api/auth/login**, **POST /api/auth/register** và **POST /api/conversations/send-messages** (Gemini streaming).

Lịch sử chat: **GET /api/conversations** lấy danh sách của user đăng nhập; **GET /api/conversations/:conversation_id/messages** lấy tin nhắn của conversation thuộc user đó. Cả hai yêu cầu Bearer token và hỗ trợ `limit`, `offset`.

## Chạy local

Yêu cầu Node.js 22 trở lên. Trong thư mục `ai-chat-be`:

```powershell
npm install
Copy-Item .env.example .env
# Điền cấu hình .env trước khi chạy
npm run dev
```

Mặc định API chạy tại `http://localhost:3001`. Frontend được phép gọi từ `http://localhost:5173`; đổi `CORS_ORIGIN` nếu frontend dùng địa chỉ khác.

## Chỗ kết nối Supabase

- **`.env`**: điền `SUPABASE_URL` và `SUPABASE_PUBLISHABLE_KEY` theo `.env.example`.
- Lấy Project URL và publishable key từ Connect dialog hoặc phần API Keys trong Supabase Dashboard. Legacy `anon` key cũng dùng được. Backend hỗ trợ `SUPABASE_SECRET_KEY`; chỉ giữ key này phía server, không đưa vào frontend. Auth ưu tiên publishable key nếu cấu hình cả hai; client truy vấn chat ưu tiên secret key backend.
- **`src/config/env.ts`**: đọc và kiểm tra biến môi trường.
- **`src/config/supabase.ts`**: khởi tạo Supabase client. Đây là chỗ cấu hình kết nối.
- SDK dùng HTTPS API của Supabase, không cần `DATABASE_URL`, password Postgres hay driver SQL cho route này.
- Mỗi lần đăng nhập tạo client riêng để phiên của các user không dùng chung.

SQL/schema hiện có trên Supabase được giữ nguyên. Các route auth xác thực tài khoản trong **Supabase Authentication**, không đọc mật khẩu từ bảng `public.users` hoặc `profiles` tự tạo. Route chat dùng `conversations` và `messages` hiện có, xác minh token rồi gắn/kiểm tra user ID của chủ sở hữu trước khi truy cập dữ liệu bằng kết nối backend. Chi tiết trong hướng dẫn API chat bên dưới.

## Tạo tài khoản và test API

Trong Supabase Dashboard, vào **Authentication → Users → Add user** để tạo email/password test. Xác nhận email tài khoản (hoặc chọn tự xác nhận khi tạo tài khoản test nếu giao diện hỗ trợ).

Postman: method `POST`, URL `http://localhost:3001/api/auth/login`, header `Content-Type: application/json`, Body → raw → JSON:

```json
{
  "email": "test@example.com",
  "password": "your-test-password"
}
```

Hoặc PowerShell:

```powershell
$body = @{ email = 'test@example.com'; password = 'your-test-password' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri 'http://localhost:3001/api/auth/login' -ContentType 'application/json' -Body $body
```

Thành công trả `200`, `success: true`, `data.user` và `data.session` gồm access token, refresh token và thời gian hết hạn. Không chia sẻ token hoặc commit `.env`.

| Status | Ý nghĩa |
| --- | --- |
| 400 | Thiếu/sai email, password hoặc JSON lỗi |
| 401 | Email/mật khẩu không hợp lệ (`invalid_credentials`) |
| 403 | Email chưa xác nhận hoặc tài khoản bị khóa |
| 404 | Route không tồn tại |
| 413 | Body quá lớn |
| 429 | Supabase giới hạn số lần đăng nhập |
| 503 | Supabase không khả dụng hoặc cấu hình key chưa đúng |
| 502 | Supabase trả về lỗi không mong đợi, không phải lỗi sai mật khẩu |

`SUPABASE_URL` nên là URL gốc của project. Nếu dán endpoint có đuôi `/rest/v1/` hoặc `/auth/v1/`, backend tự chuẩn hóa về URL gốc. Secret key được hỗ trợ ở backend qua `SUPABASE_SECRET_KEY`; tên biến cũ vẫn được chấp nhận để tương thích cấu hình đã có. Sau khi sửa `.env`, dừng và chạy lại server. Khi dùng `npm start`, chạy `npm run build` trước để cập nhật bản build.

Lỗi đăng nhập có trường `code` để phân biệt nguyên nhân. Trong development, terminal chỉ ghi status/code/name của lỗi Supabase, không ghi email, mật khẩu hay token.

## Đăng ký tài khoản

Postman: **POST** `http://localhost:3001/api/auth/register`, Body → raw → JSON:

```json
{
  "email": "new-user@example.com",
  "password": "YourStrongPassword123!"
}
```

Mật khẩu tối thiểu 8 ký tự, giữ nguyên khoảng trắng nếu có. Supabase có thể yêu cầu chính sách mật khẩu mạnh hơn theo cấu hình project. Route tạo tài khoản Supabase Auth, không tự ghi vào bảng profile riêng; trigger SQL hiện có trên Supabase vẫn chạy bình thường.

- **201**: đăng ký có session (khi project không yêu cầu xác nhận email). `data.user` và `data.session` có dữ liệu, `email_confirmation_required: false`.
- **202**: yêu cầu được tiếp nhận, cần kiểm tra email. `data.user` và `data.session` là `null`, `email_confirmation_required: true`. Không khẳng định tài khoản mới đã được tạo, vì Supabase có thể che giấu email đã tồn tại. Xác nhận email rồi gọi route login.
- **400**: đầu vào không hợp lệ, mật khẩu yếu hoặc email không được phép nhận thư.
- **403**: Supabase tắt đăng ký/email provider.
- **409**: Supabase trả rõ lỗi email đã tồn tại. Khi bật xác nhận email, có thể trả 202 thay vì 409.
- **429**: vượt giới hạn đăng ký/gửi email.
- **502/503**: lỗi Supabase/cấu hình/dịch vụ không khả dụng.

Trong Supabase Authentication, bật cho phép đăng ký user mới và email/password provider. Cấu hình Site URL cho link xác nhận; route dùng luồng email mặc định của Supabase, không tự xác nhận email hoặc gọi API admin. Nếu bật CAPTCHA, cần bổ sung luồng CAPTCHA trước khi dùng route này. Không cần đổi key đang dùng trong `.env`.

Tài liệu: [Supabase signUp](https://supabase.com/docs/reference/javascript/auth-signup).

## Gửi tin nhắn và stream Gemini

Xem [hướng dẫn API chat](docs/send-messages.md) để cấu hình Gemini, gọi từ Postman/cURL/FE và đọc stream SSE. Route dùng bảng `conversations` và `messages` hiện có; không cần tạo bảng mới.

## Lệnh khác

```powershell
npm run typecheck
npm test
npm run build
npm start
```

`npm start` chạy bản đã build trong `dist/`. Chưa triển khai đăng xuất, refresh token hoặc xóa lịch sử chat.

Tài liệu: [Supabase password login](https://supabase.com/docs/reference/javascript/auth-signinwithpassword), [API keys](https://supabase.com/docs/guides/getting-started/api-keys).
