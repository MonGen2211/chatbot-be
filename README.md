# AI Chat Backend

Backend Express + TypeScript. Hiện chỉ có **POST /api/auth/login**, dùng email/password qua Supabase Auth.

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
- Lấy Project URL và publishable key từ Connect dialog hoặc phần API Keys trong Supabase Dashboard. Legacy `anon` key cũng dùng được. Backend hỗ trợ `SUPABASE_SECRET_KEY` nếu dùng secret key; chỉ giữ key này phía server, không đưa vào frontend. Publishable key được ưu tiên nếu cấu hình cả hai.
- **`src/config/env.ts`**: đọc và kiểm tra biến môi trường.
- **`src/config/supabase.ts`**: khởi tạo Supabase client. Đây là chỗ cấu hình kết nối.
- SDK dùng HTTPS API của Supabase, không cần `DATABASE_URL`, password Postgres hay driver SQL cho route này.
- Mỗi lần đăng nhập tạo client riêng để phiên của các user không dùng chung.

SQL/schema hiện có trên Supabase được giữ nguyên. Route này xác thực tài khoản trong **Supabase Authentication**, không đọc mật khẩu từ bảng `public.users` hoặc `profiles` tự tạo. Chưa có truy vấn bảng SQL nào vì chưa có schema local để đối chiếu. Khi thêm truy vấn sau này, cần gắn access token của người gọi và cấu hình RLS tương ứng.

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

## Lệnh khác

```powershell
npm run typecheck
npm run build
npm start
```

`npm start` chạy bản đã build trong `dist/`. Chưa triển khai đăng ký, đăng xuất, refresh token hoặc các route chat.

Tài liệu: [Supabase password login](https://supabase.com/docs/reference/javascript/auth-signinwithpassword), [API keys](https://supabase.com/docs/guides/getting-started/api-keys).
