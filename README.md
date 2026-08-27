# Đối Chiếu Dữ Liệu

Ứng dụng web để tổng hợp và đối chiếu dữ liệu Mua Hàng, Quét Mã và Nhập Kho từ Excel.

## Web tĩnh độc lập cho Cloudflare Pages

File [standalone/index.html](standalone/index.html) là bản độc lập hoàn toàn, không gọi API và không cần chạy Node.js. Có thể tải duy nhất file này lên Cloudflare Pages hoặc bất kỳ static hosting nào.

Tạo lại file sau khi sửa mã nguồn:

```powershell
npm run build:web
```

Dữ liệu và thao tác Excel của bản này chạy hoàn toàn trong trình duyệt. IndexedDB lưu dữ liệu riêng trên từng trình duyệt/máy; dữ liệu không tự đồng bộ giữa các máy và việc xóa dữ liệu trang web của trình duyệt cũng sẽ xóa dữ liệu ứng dụng.

## Chạy ứng dụng desktop

```powershell
npm install
npm start
```

`npm start` luôn mở ứng dụng Electron trên Windows. Chỉ chạy máy chủ web khi chủ động dùng:

```powershell
npm run start:web
```

Mở `http://localhost:3000` trên máy đang chạy ứng dụng. Các máy khác trong cùng mạng có thể truy cập bằng địa chỉ IP của máy chủ, ví dụ `http://192.168.1.10:3000`.

Có thể đổi cấu hình bằng biến môi trường:

```powershell
$env:PORT=8080
$env:HOST="127.0.0.1"
$env:APP_DATA_DIR="D:\doi-chieu-data"
npm run start:web
```

- `PORT` mặc định là `3000`.
- `HOST` mặc định là `0.0.0.0` để cho phép truy cập trong mạng nội bộ.
- `APP_DATA_DIR` mặc định là thư mục `data` trong dự án.

## Dữ liệu

- Dữ liệu được lưu trên máy chủ, dùng chung cho mọi trình duyệt truy cập cùng địa chỉ web.
- File Excel tải lên chỉ được giữ tạm trong lúc đọc dữ liệu.
- Bản gốc Mua Hàng và các bản sao lưu JSON nằm trong thư mục dữ liệu máy chủ.
- Nút **Clear dữ liệu phiên** chỉ xóa Quét Mã và các xác nhận; không xóa Mua Hàng, Nhập Kho và Xưởng Gia Công.
- Xóa toàn bộ cơ sở dữ liệu vẫn yêu cầu ba lần xác nhận và từ khóa `XÓA`.

## Kiểm thử

```powershell
npm test
npm run check
```

Hai lệnh trên chỉ kiểm tra ứng dụng desktop. Kiểm thử và kiểm tra cú pháp bản web chỉ chạy khi chủ động dùng `npm run test:web` và `npm run check:web`.

Lệnh `npm run start:desktop` vẫn được giữ làm tên gọi tương đương với `npm start`.
