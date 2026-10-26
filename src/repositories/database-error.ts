import { HttpError } from '../middlewares/error.middleware';

interface DatabaseError { code?: string; message?: string }

export function databaseError(operation: string, error: DatabaseError | null): HttpError {
  // SQLSTATE and constraint identifiers identify the cause without logging row
  // details, which can contain messages, credentials, or other personal data.
  const code = error?.code && /^[A-Z0-9]{5,12}$/.test(error.code) ? error.code : 'unknown';
  const constraint = error?.message?.match(/constraint "([A-Za-z0-9_]+)"/)?.[1];
  console.error('Supabase database operation failed:', { operation, code, ...(constraint ? { constraint } : {}) });
  switch (code) {
    case '42501':
      return new HttpError(403, 'Database từ chối quyền truy cập (42501). Kiểm tra quyền bảng của kết nối backend; tắt RLS không tự cấp quyền bảng.', 'database_permission_denied');
    case '23503':
      return new HttpError(409, 'Lỗi khóa ngoại (23503). Kiểm tra profile có ID đúng với user đăng nhập và các dữ liệu liên kết.', 'database_foreign_key_violation');
    case '23514':
      return new HttpError(503, 'Dữ liệu không thỏa CHECK constraint của database (23514). Kiểm tra ràng buộc model, provider, role hoặc status của bảng.', 'database_check_violation');
    case '23502':
      return new HttpError(503, 'Thiếu giá trị bắt buộc trong database (23502). Kiểm tra cột NOT NULL và default của bảng.', 'database_not_null_violation');
    case '42P01':
    case '42703':
    case 'PGRST204':
    case 'PGRST205':
      return new HttpError(503, 'Schema database không khớp với backend. Kiểm tra tên bảng, cột và schema cache.', 'database_schema_mismatch');
    default:
      return new HttpError(503, 'Thao tác database thất bại. Xem mã lỗi trong terminal backend để xác định nguyên nhân.', 'database_error');
  }
}
