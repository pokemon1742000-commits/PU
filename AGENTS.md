# Hướng dẫn làm việc trong repository

- Sau khi sửa mã nguồn, chỉ chạy `npm test` và `npm run check` để xác minh thông thường.
- Không tự động chạy `npm run dist` sau mỗi lần sửa.
- Chỉ build bản Windows portable khi người dùng yêu cầu rõ ràng hoặc khi chạy `npm run publish`.
- Lệnh phát hành chuẩn là `npm run publish -- "Nội dung commit"`.
- Ở lần publish đầu tiên, nếu chưa có remote, dùng `npm run publish -- "Nội dung commit" "URL_GITHUB"`.
