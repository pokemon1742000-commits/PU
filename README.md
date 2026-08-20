# Đối Chiếu Dữ Liệu

Ứng dụng desktop offline để tổng hợp và đối chiếu dữ liệu Mua Hàng, Quét Mã và Nhập Kho từ Excel.

## Chạy ứng dụng

```powershell
npm install
npm start
```

Nếu PowerShell chặn `npm.ps1`, dùng lệnh tương đương không cần đổi Execution Policy:

```powershell
npm.cmd start
```

Hoặc nhấp đúp `start-app.cmd` trong thư mục dự án.

## Kiểm thử

```powershell
npm test
npm run check
```

## Dữ liệu

- Dữ liệu Mua Hàng tích lũy được lưu trong thư mục `userData/data` của Electron.
- Trước mỗi lần cập nhật hoặc xóa, app tạo backup JSON trong `userData/data/backups`.
- Nút **Clear dữ liệu** chỉ xóa dữ liệu phiên; không xóa baseline Mua Hàng.
- Xóa baseline yêu cầu ba lần xác nhận và từ khóa `XÓA`.

## Đóng gói Windows

```powershell
npm run dist
```

File portable được tạo trong thư mục `dist`.

## Tự cập nhật qua GitHub

Bản cài đặt Windows có nút **Update** trên thanh tiêu đề. Khi có phiên bản mới, ứng dụng tải bộ cài từ GitHub Releases, tự đóng, cài đặt ngầm theo tài khoản Windows hiện tại và mở lại mà không hỏi xác nhận.

Lần đầu cần cài bản `Doi-Chieu-Setup-x.y.z.exe` từ GitHub Releases; bản portable không hỗ trợ cơ chế tự thay thế này.

Phát hành tự động một phiên bản mới:

```powershell
npm run release:auto -- "Nội dung cập nhật"
```

Lệnh tự tăng phiên bản vá, chạy kiểm thử, build bộ cài NSIS, commit/push nhánh `main`, tạo tag và phát hành file cập nhật lên `https://github.com/pokemon1742000-commits/PU`. Máy phát hành cần đăng nhập bằng `gh auth login` hoặc có biến môi trường `GH_TOKEN` với quyền ghi nội dung repository.

## Build, commit và cập nhật GitHub bằng một lệnh

Lần đầu tiên, truyền thêm URL repository GitHub:

```powershell
npm run publish -- "Khởi tạo dự án" "https://github.com/ten-cua-ban/ten-repository.git"
```

Các lần sau chỉ cần:

```powershell
npm run publish -- "Mô tả thay đổi"
```

Trên PowerShell đang chặn script, dùng:

```powershell
.\publish-github.cmd "Mô tả thay đổi"
```

Lệnh sẽ tuần tự chạy kiểm thử, kiểm tra cú pháp, build bản portable, commit toàn bộ thay đổi mã nguồn và push nhánh hiện tại lên `origin`. Thư mục `dist` được giữ trên máy và không commit lên GitHub.
