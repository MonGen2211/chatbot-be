# AI Chat Backend

Express + TypeScript, truy vấn PostgreSQL trực tiếp bằng `pg`, tự quản lý auth bằng bcrypt + JWT và gọi Gemini streaming. PostgreSQL vẫn có thể host trên Supabase; backend không gọi Supabase Auth/Data API nữa.

## Cấu hình và chạy

Node.js 22 trở lên. Trong `ai-chat-be`, tạo `.env` theo `.env.example` nếu chưa có. Không copy đè `.env` đã điền key.

- `DATABASE_URL`: PostgreSQL URI từ Supabase → Connect → Session pooler, giống kết nối DBeaver. Điền mật khẩu database thật và URL-encode các ký tự đặc biệt trong mật khẩu. Đây không phải Supabase API key. Ưu tiên Session pooler cổng 5432; transaction pooler 6543 cũng hỗ trợ vì code không dùng prepared statement có tên.
- `JWT_SECRET`: chuỗi ngẫu nhiên ít nhất 32 byte, giữ riêng trên backend. Đã tạo một secret ngẫu nhiên trong `.env` local nếu trước đó chưa có.
- `JWT_EXPIRES_IN`: mặc định `1h`, cho phép từ 60 giây tới 7 ngày.
- `GEMINI_API_KEY`, `GEMINI_MODEL`: key/model Google AI Studio, chỉ dùng ở backend.
- `CORS_ORIGIN`: địa chỉ FE, mặc định `http://localhost:5173`.

```powershell
npm.cmd install
npm.cmd run db:check
npm.cmd run db:migrate
npm.cmd run db:types
npm.cmd run dev
```

`db:check` chỉ kiểm tra kết nối và bảng, không ghi dữ liệu. `db:migrate` thay đổi schema/copy tài khoản theo migration đã chuẩn bị. Chạy migration trước khi gọi API. API mặc định ở `http://localhost:3001`.

Kết nối database dùng TLS có kiểm tra chứng chỉ. Nếu gặp lỗi CA, tải certificate database trong Supabase và cấu hình `DATABASE_CA_FILE`; không tắt kiểm tra chứng chỉ. Pool giới hạn 5 kết nối, query có timeout và shutdown đóng pool. Không cần Supabase URL/publishable/secret API key ở runtime; các biến cũ trong `.env` có thể giữ tạm nhưng không được code dùng.

## Chuyển tài khoản Supabase Auth cũ

Migration `migrations/001_local_auth.sql` chạy trong transaction, có bảng theo dõi và checksum để không chạy lặp:

- Tạo `app_private.users` để lưu email, password hash, trạng thái tài khoản và token version. Schema này không được public qua Supabase Data API.
- Copy user cũ từ `auth.users`, giữ nguyên UUID, hash bcrypt, trạng thái xác nhận email, khóa/xóa tài khoản.
- Đổi khóa ngoại `profiles.id` sang `app_private.users.id`. Bảng profiles, conversations và messages cùng dữ liệu chat hiện có được giữ lại. Không xóa schema `auth` hay user cũ.
- Người dùng email/password cũ đã xác nhận email có thể đăng nhập lại bằng mật khẩu cũ. Token Supabase cũ không còn được backend chấp nhận.
- User chưa xác nhận email trước khi chuyển vẫn bị chặn; không tự bỏ trạng thái này. Tài khoản social/passwordless vẫn được giữ ID nhưng không thể đăng nhập bằng mật khẩu khi chưa có password hash. Chưa có API xác nhận email/đặt lại mật khẩu cho các trường hợp này.
- Tài khoản đăng ký mới được tạo trong `app_private.users` cùng profile bằng một transaction; không ghi vào `auth.users`, không gửi email xác nhận và trả session ngay.

Kiểm tra/backup database trước khi áp dụng migration lên môi trường có dữ liệu quan trọng. Nếu gặp email trùng khi chuẩn hóa chữ thường hoặc dữ liệu liên kết không hợp lệ, migration rollback thay vì bỏ qua/mất dữ liệu. Chỉ backend có DB credentials truy cập schema riêng. Không tiếp tục đăng ký qua Supabase Auth sau khi chuyển sang auth của backend.

## APIs cho FE/Postman

- `POST /api/auth/register`: `{ "email": "new@example.com", "password": "StrongPassword123!" }`, trả 201.
- `POST /api/auth/login`: `{ "email": "new@example.com", "password": "StrongPassword123!" }`, trả 200.
- `GET /api/conversations?limit=50&offset=0`: conversation của user đăng nhập.
- `GET /api/conversations/:conversation_id/messages?limit=50&offset=0`: lịch sử của conversation thuộc user đó.
- `POST /api/conversations/send-messages`: Gemini SSE. Body `{ "message": "...", "conversation_id": "UUID nếu chat tiếp" }`.

Auth trả `data.user` và `data.session.access_token`, `token_type`, `expires_in`, `expires_at`. FE tiếp tục dùng `Authorization: Bearer <access_token>` cho chat/history. Không có refresh token; hết hạn thì đăng nhập lại. Chưa triển khai logout server, refresh, quên mật khẩu hoặc xác nhận email. Đăng ký mật khẩu tối thiểu 8 ký tự, tối đa 72 byte UTF-8 vì bcrypt. Login dùng email không phân biệt chữ hoa/thường và mật khẩu giữ nguyên khoảng trắng.

Đăng nhập/đăng ký giới hạn chung 30 request/15 phút/IP trong mỗi process. Chưa cấu hình trust proxy; khi triển khai sau reverse proxy cần thiết lập đúng địa chỉ proxy tin cậy và cân nhắc store rate-limit dùng chung nếu có nhiều instance.

Backend lấy ID chủ sở hữu từ JWT đã xác minh và kiểm tra tài khoản còn hoạt động. Không lấy `user_id` từ body/query. Mọi truy vấn chat có điều kiện user ID; không có phân vai admin/user. Database vẫn kiểm tra quyền kết nối, khóa ngoại và constraints. Backend không tự tắt/bật RLS trên các bảng chat.

Chi tiết: [send-messages.md](docs/send-messages.md).

## Types và kiểm tra

`npm.cmd run db:types` đọc metadata `information_schema`/PostgreSQL để sinh types cho các bảng public vào `src/types/database.types.ts`. Không đọc nội dung tài khoản/tin nhắn, không cần Supabase CLI/API key. Generator hỗ trợ columns, nullability, defaults, enum values và kiểu dữ liệu đang dùng; chưa sinh join Relationships, views hoặc RPC. `chat.types.ts` giữ DTO request/response/streaming dựa trên types public. Các query `pg` dùng generic Row type và tham số `$1`, `$2`; schema types không tự kiểm tra cú pháp SQL lúc compile.

```powershell
npm.cmd run build
npm.cmd test
npm.cmd start
```

Các file test hiện có đã chuyển sang giả lập PostgreSQL và Gemini, không ghi vào database thật và không gọi Google. Kiểm tra thật cần `DATABASE_URL` hợp lệ và migration đã chạy. `npm start` dùng bản build trong `dist/`.

Tài liệu: [node-postgres queries](https://node-postgres.com/features/queries), [Supabase PostgreSQL connections](https://supabase.com/docs/guides/database/connecting-to-postgres).
