const uuid = { type: 'string', format: 'uuid' };
const messageSchema = {
  type: 'object',
  properties: {
    id: uuid, conversation_id: uuid, role: { type: 'string', enum: ['user', 'assistant'] }, content: { type: 'string' },
    created_at: { type: 'string', format: 'date-time' }, parent_message_id: { oneOf: [uuid, { type: 'null' }] },
    status: { type: 'string', enum: ['pending', 'completed', 'failed'] }, sequence_no: { type: 'string' },
    is_edited: { type: 'boolean' }, edited_at: { oneOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
    model: { oneOf: [{ type: 'string' }, { type: 'null' }] }, updated_at: { type: 'string', format: 'date-time' },
  },
};
const sseResponse = {
  description: 'Server-Sent Events. Listen for conversation, delta, reset, superseded, done, and error events.',
  content: { 'text/event-stream': { schema: { type: 'string', example: 'event: delta\\ndata: {"text":"Hello"}\\n\\n' } } },
};
const authError = { description: 'Thiếu hoặc access token không hợp lệ.' };
const badRequest = { description: 'Request không hợp lệ.' };

export const openapiDocument = {
  openapi: '3.0.3',
  info: { title: 'AI Chat API', version: '1.0.0', description: 'API cho đăng ký/đăng nhập, quản lý hội thoại và chat AI dạng Server-Sent Events (SSE).' },
  servers: [{ url: '/', description: 'Backend hiện tại' }],
  tags: [
    { name: 'Auth', description: 'Đăng ký và đăng nhập' },
    { name: 'Conversations', description: 'Danh sách và quản lý hội thoại' },
    { name: 'Messages', description: 'Đọc lịch sử tin nhắn' },
    { name: 'Chat', description: 'Gửi, sửa và thử lại tin nhắn; phản hồi SSE' },
    { name: 'Legacy', description: 'Các endpoint tương thích với frontend cũ' },
  ],
  paths: {
    '/api/auth/register': { post: { tags: ['Auth'], summary: 'Đăng ký tài khoản', requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Credentials' } } } }, responses: { '201': { description: 'Đăng ký thành công; trả về user và access token.' }, '400': badRequest, '409': { description: 'Email đã được sử dụng.' }, '429': { description: 'Vượt giới hạn đăng ký/đăng nhập.' } } } },
    '/api/auth/login': { post: { tags: ['Auth'], summary: 'Đăng nhập', requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Credentials' } } } }, responses: { '200': { description: 'Đăng nhập thành công; trả về user và access token.' }, '400': badRequest, '401': { description: 'Email hoặc mật khẩu không đúng.' }, '429': { description: 'Vượt giới hạn đăng ký/đăng nhập.' } } } },
    '/api/conversations': { get: { tags: ['Conversations'], summary: 'Lấy danh sách hội thoại', security: [{ bearerAuth: [] }], parameters: [{ $ref: '#/components/parameters/Limit' }, { $ref: '#/components/parameters/Offset' }], responses: { '200': { description: 'Danh sách hội thoại của người dùng.' }, '400': badRequest, '401': authError } } },
    '/api/conversations/{conversation_id}': {
      patch: { tags: ['Conversations'], summary: 'Đổi tên hội thoại', security: [{ bearerAuth: [] }], parameters: [{ $ref: '#/components/parameters/ConversationId' }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['title'], properties: { title: { type: 'string', minLength: 1, maxLength: 200 } } } } } }, responses: { '200': { description: 'Hội thoại đã được đổi tên.' }, '400': badRequest, '401': authError, '404': { description: 'Không tìm thấy hội thoại.' } } },
      delete: { tags: ['Conversations'], summary: 'Xóa hội thoại và các tin nhắn', security: [{ bearerAuth: [] }], parameters: [{ $ref: '#/components/parameters/ConversationId' }], responses: { '200': { description: 'Hội thoại đã được xóa.' }, '400': badRequest, '401': authError, '404': { description: 'Không tìm thấy hội thoại.' } } },
    },
    '/api/messages': { get: { tags: ['Messages'], summary: 'Lấy lịch sử tin nhắn', security: [{ bearerAuth: [] }], parameters: [{ name: 'conversation_id', in: 'query', required: true, schema: uuid }, { $ref: '#/components/parameters/Limit' }, { $ref: '#/components/parameters/Offset' }], responses: { '200': { description: 'Danh sách tin nhắn.', content: { 'application/json': { schema: { $ref: '#/components/schemas/MessageListResponse' } } } }, '400': badRequest, '401': authError, '404': { description: 'Không tìm thấy hội thoại.' } } } },
    '/api/chat': { post: { tags: ['Chat'], summary: 'Gửi tin nhắn và nhận phản hồi AI', description: 'Trả về SSE. message_id là UUID do client tạo; conversation_id bỏ qua khi tạo hội thoại mới.', security: [{ bearerAuth: [] }], requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/SendMessage' } } } }, responses: { '200': sseResponse, '400': badRequest, '401': authError, '502': { description: 'Không lấy được phản hồi từ Gemini.' }, '504': { description: 'Quá thời gian chờ Gemini.' } } } },
    '/api/chat/messages/{message_id}/retry': { post: { tags: ['Chat'], summary: 'Thử lại phản hồi assistant bị lỗi', security: [{ bearerAuth: [] }], parameters: [{ $ref: '#/components/parameters/MessageId' }], responses: { '200': sseResponse, '400': badRequest, '401': authError, '404': { description: 'Không tìm thấy tin nhắn.' } } } },
    '/api/chat/messages/{message_id}': { patch: { tags: ['Chat'], summary: 'Sửa tin nhắn user và tạo phản hồi mới', security: [{ bearerAuth: [] }], parameters: [{ $ref: '#/components/parameters/MessageId' }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['message'], properties: { message: { type: 'string', minLength: 1, maxLength: 12000 } } } } } }, responses: { '200': sseResponse, '400': badRequest, '401': authError, '404': { description: 'Không tìm thấy tin nhắn.' } } } },
    '/api/conversations/send-messages': { post: { tags: ['Legacy'], summary: 'Gửi tin nhắn (URL tương thích cũ)', security: [{ bearerAuth: [] }], requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/SendMessage' } } } }, responses: { '200': sseResponse, '400': badRequest, '401': authError } } },
    '/api/conversations/{conversation_id}/messages': { get: { tags: ['Legacy'], summary: 'Lấy lịch sử tin nhắn (URL tương thích cũ)', security: [{ bearerAuth: [] }], parameters: [{ $ref: '#/components/parameters/ConversationId' }, { $ref: '#/components/parameters/Limit' }, { $ref: '#/components/parameters/Offset' }], responses: { '200': { description: 'Danh sách tin nhắn.', content: { 'application/json': { schema: { $ref: '#/components/schemas/MessageListResponse' } } } }, '400': badRequest, '401': authError, '404': { description: 'Không tìm thấy hội thoại.' } } } },
  },
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Dán access_token nhận từ API register hoặc login.' } },
    parameters: {
      ConversationId: { name: 'conversation_id', in: 'path', required: true, schema: uuid },
      MessageId: { name: 'message_id', in: 'path', required: true, schema: uuid },
      Limit: { name: 'limit', in: 'query', description: 'Số bản ghi (1–100, mặc định 50).', schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 } },
      Offset: { name: 'offset', in: 'query', description: 'Vị trí bắt đầu (mặc định 0).', schema: { type: 'integer', minimum: 0, maximum: 1000000, default: 0 } },
    },
    schemas: {
      Credentials: { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string', format: 'email', maxLength: 254, example: 'user@example.com' }, password: { type: 'string', minLength: 8, maxLength: 72, description: 'Đăng nhập chấp nhận tối đa 4096 ký tự; đăng ký tối thiểu 8 ký tự và tối đa 72 byte UTF-8.' } } },
      SendMessage: { type: 'object', required: ['message_id', 'message'], properties: { message_id: { ...uuid, description: 'UUID do client tạo, dùng cho idempotency.' }, message: { type: 'string', minLength: 1, maxLength: 12000 }, conversation_id: uuid } },
      OperationMessage: messageSchema,
      MessageListResponse: { type: 'object', properties: { success: { type: 'boolean', example: true }, data: { type: 'array', items: { $ref: '#/components/schemas/OperationMessage' } } } },
    },
  },
} as const;
