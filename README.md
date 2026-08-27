# Đối Chiếu Dữ Liệu Mua Hàng

Ứng dụng Electron dành cho Windows, dùng để nhập và đối chiếu dữ liệu **Mua Hàng**, **Quét Mã**, **Nhập Kho** và **Xưởng Gia Công**, sau đó xuất báo cáo Excel theo mẫu `SỐ LIỆU XUẤT KHO`.

- Phiên bản hiện tại: **v1.0.11**
- Repository: <https://github.com/pokemon1742000-commits/PU>
- Chế độ chạy mặc định: ứng dụng desktop Electron

## 1. Khởi động phần mềm

Yêu cầu Node.js và npm đã được cài đặt.

```powershell
npm install
npm start
```

`npm start` luôn mở ứng dụng desktop. Lệnh tương đương:

```powershell
npm run start:desktop
```

## 2. Các nguồn dữ liệu

Phần mềm hỗ trợ file `.xlsx` và `.xlsm`, có thể chọn nhiều file và nhiều sheet trong một lần nạp. Hàng tiêu đề được tìm trong 30 dòng đầu của mỗi sheet.

### 2.1. Dữ liệu Mua Hàng

Dùng làm số lượng chuẩn để đối chiếu.

| Cột trong file nguồn | Ý nghĩa trong phần mềm |
|---|---|
| `Mã hàng` | Số PR |
| `ĐVT` | Mã hàng |
| `Maker` hoặc `Marker` | Tên hàng |
| `Tình trạng` | Số lượng mua hàng |
| `Nhà cung cấp`, `NCC` hoặc `Supplier` | Nhà cung cấp nếu có |

Mã dự án `MEC...` hoặc `AUT...` được trích xuất từ Số PR. Các dòng cùng mã dự án và mã hàng được gộp số lượng nhưng vẫn lưu thông tin file, sheet và dòng nguồn.

Dữ liệu Mua Hàng được lưu dài hạn. Nạp lại file sẽ:

- thêm mã mới;
- cập nhật dòng đã thay đổi;
- không tạo bản ghi trùng khi dữ liệu không đổi;
- tạo backup trước khi cập nhật dữ liệu dài hạn.

### 2.2. Dữ liệu Quét Mã

Mỗi dòng dữ liệu quét mã gồm đúng 7 trường, phân cách bằng dấu phẩy:

1. Mã dự án;
2. mã bản vẽ/mã hàng;
3. số lượng hoặc nhà sản xuất;
4. nhà sản xuất hoặc số lượng;
5. mã nhận hàng;
6. ngày nhập kho;
7. thông tin tham chiếu.

Phần mềm tự nhận biết vị trí số lượng và nhà sản xuất ở trường 3–4. Nếu không xác định được, dòng đó được đưa vào Cảnh Báo để kiểm tra thủ công.

Các dòng ngày như `15/Aug`, `15-Aug-2026` hoặc ngày Excel được dùng làm mốc ngày quét. Dòng quét trước mốc ngày đầu tiên và dòng không đủ 7 trường đều được ghi nhận/cảnh báo rõ ràng.

Dữ liệu Quét Mã được cộng dồn theo dự án, mã bản vẽ, nhà sản xuất và ngày quét. Dữ liệu được giữ khi đóng/mở phần mềm, nhưng bị xóa khi dùng **Clear dữ liệu phiên**.

### 2.3. Dữ liệu Nhập Kho

| Trường | Tên cột được hỗ trợ |
|---|---|
| Dự án | `Tên dự án` |
| Mã hàng | `Mã Hàng` hoặc `Mã hàng` |
| Tên hàng | `Tên Hàng` hoặc `Tên hàng` |
| Nhà cung cấp | `NCC` |
| PO | `Mã PO`, `Số PO`, `PO`, `PO No`, `PO No.`, `PO Number` hoặc `Mã đơn hàng` |
| Số lượng đặt | `Số lượng đặt hàng` |
| Hạn giao | `Hạn giao hàng` |
| Ngày giao | `Ngày giao hàng` |
| Số lượng nhập | `Số lượng đã về` |

Mã dự án được trích xuất từ `Tên dự án`. Dòng không chứa mã `MEC...` hoặc `AUT...` được bỏ qua và đưa vào Cảnh Báo.

Dữ liệu Nhập Kho là cơ sở dữ liệu dài hạn. Nạp file mới chỉ thêm/cập nhật và không bị xóa bởi **Clear dữ liệu phiên**.

### 2.4. Dữ liệu Xưởng Gia Công

Nguồn này hoạt động tương tự Nhập Kho nhưng dùng bố cục của báo cáo XGC.

| Cột file XGC | Trường trong phần mềm |
|---|---|
| Cột B | Số PO |
| Cột C, tiêu đề `STT` | Ngày PR |
| Cột D, tiêu đề `MKS` | Số PR/MKS |
| Cột E | Mã hàng |
| Cột F | Tên hàng |
| Cột H | Số lượng đặt |
| Cột I | Hạn ngày về |
| Cột J | Số lượng nhập kho |
| Cột K | Ngày nhập kho |

Chỉ những mã hàng có hậu tố `_GC` được nhập từ nguồn Xưởng Gia Công. Mã dự án được lấy từ MKS trước, nếu không có thì lấy từ PO.

Dữ liệu XGC được lưu dài hạn, có bảng riêng, xem được dữ liệu gốc, hỗ trợ tìm kiếm/phân trang và không bị xóa bởi **Clear dữ liệu phiên**.

### 2.5. Job Code tích hợp

File `assets/MKAC Monthly Timesheet.xlsx` được đóng gói sẵn làm dữ liệu Job Code tham chiếu. Người dùng không cần nạp thủ công.

Trang **Xem Job Code** cho phép kiểm tra danh sách mã và đánh dấu mã trùng trong file tham chiếu.

## 3. Quy tắc đối chiếu mã

Đối chiếu luôn giới hạn trong cùng mã dự án.

### Khớp chính xác

Mã giống nhau sau khi chuẩn hóa chữ hoa/thường và khoảng trắng được ghép trực tiếp.

### Quy tắc `_GC`

Hai mã chỉ khác đúng hậu tố `_GC` được tự động ghép, ví dụ:

```text
2208022-TO-033 ↔ 2208022-TO-033_GC
```

Nếu phần mã trước `_GC` khác nhau, phần mềm không tự ghép theo quy tắc này mà chuyển sang so sánh phần trăm.

### Ghép theo phần trăm

- Mặc định từ **91%** trở lên: tự ghép.
- Từ **90%** đến dưới 91%: đưa vào trang **Xác Nhận**.
- Dưới **90%**: tự bỏ qua, không yêu cầu xác nhận.

Hai ngưỡng có thể thay đổi ở thanh bên trái. Ngưỡng xác nhận luôn phải thấp hơn ngưỡng tự ghép.

Tại trang Xác Nhận, người dùng có thể chọn mã ứng viên, ghép từng nguồn, bỏ qua nguồn không đúng hoặc đưa lựa chọn trở lại trạng thái cần xác nhận. Các lựa chọn được lưu trong phiên và chỉ bị xóa khi Clear dữ liệu phiên.

## 4. Đổi mã đã duyệt PR

Trang **Đổi mã duyệt PR** dùng cho trường hợp PR cũ đã duyệt nhưng mã hàng được thay bằng mã mới.

Mỗi liên kết gồm mã dự án, mã hàng cũ và mã hàng mới. Cả mã cũ và mã mới phải tồn tại trong dữ liệu Mua Hàng của cùng dự án.

Khi đối chiếu:

- số lượng của PR mã cũ không bị tính lặp;
- Quét Mã và Nhập Kho/XGC được so với mã mới;
- giao diện và Excel hiển thị `mã cũ` gạch ngang → `mã mới`;
- Số PR cũ gạch ngang → Số PR mới nếu tra được;
- liên kết có thể được xóa tại trang Đổi mã.

Danh sách đổi mã có phân trang, mỗi trang 100 dòng.

## 5. Phân loại kết quả

Phần mềm tạo các nhóm **Đủ Hàng**, **Thiếu**, **Thừa** và **Cần xác nhận**.

| Điều kiện | Tình trạng xuất Excel | Người vận hành |
|---|---|---|
| Không có Mua Hàng nhưng có Quét Mã hoặc Nhập Kho/XGC | `Check lại` | `PU check` |
| SL quét mã ≥ SL mua hàng | `OK` | Để trống |
| SL quét mã < SL mua hàng và SL nhập kho = 0 | `Chưa về` | NCC nếu đã có đơn; nếu chưa có thì `PU check` |
| SL nhập kho < SL mua hàng | `Chưa về đủ` | NCC hoặc `PU check` |
| SL nhập kho ≥ SL mua hàng nhưng SL quét còn thiếu | `Chưa bắn code` | `Kho` |

Danh sách chọn trong cột Tình trạng còn có `Đã về`, `Hủy`, `Tồn` và `Common` để người dùng điều chỉnh thủ công sau khi xuất.

Quy tắc bổ sung:

- dòng `OK` không hiển thị Người Vận Hành;
- Người Vận Hành `Kho` và `PU check` được tô hai màu khác nhau;
- PO và Hạn Giao Hàng chỉ xuất ở dòng `Chưa về` hoặc `Chưa về đủ`;
- `Chưa bắn code` không xuất PO/hạn giao;
- nếu Mua Hàng có Số PR nhưng không có bản ghi tương ứng ở cả Nhập Kho lẫn XGC, cột Note ghi `PU Check`;
- các Note nội bộ dài của quá trình đối chiếu không được đưa vào file xuất.

## 6. Xuất báo cáo Excel

Nút **Xuất Excel** tạo một workbook với một sheet đối chiếu. Nếu có nhiều dự án, sheet có tên `NHIỀU DỰ ÁN`.

Các cột xuất ra:

1. STT
2. Mã dự án
3. Mã hàng
4. Tên hàng
5. Số lượng BOOM
6. Số liệu XK
7. Maker
8. Ngày bắn code
9. Ngày nhập kho
10. Số lượng nhập kho
11. Tình trạng
12. Note
13. Người Vận Hành
14. Mã PO
15. Hạn Giao Hàng
16. Note đổi mã
17. Đổi PR

Các cột số được định dạng dạng số nguyên, không có dấu chấm thập phân ở cuối. Cột Tình trạng là danh sách chọn Excel. Ô số liệu xuất kho được tô màu theo thiếu/thừa.

## 7. Giao diện và thao tác hỗ trợ

- Bảng thống kê số dòng của từng nguồn và từng nhóm kết quả.
- Tìm kiếm theo mã dự án, mã hàng hoặc tên hàng.
- Phân trang 100 dòng để xử lý bộ dữ liệu lớn.
- **Xem file gốc** để chuyển giữa dữ liệu đã gộp và từng dòng Excel ban đầu.
- Trang **Cảnh Báo** cho dòng sai định dạng hoặc không trích xuất được dự án.
- Bốn chủ đề màu giao diện.
- Logo, phiên bản hiện tại và lịch sử cải tiến trong nút thông tin `i`.
- Hướng dẫn sử dụng có hình minh họa vị trí và cách dùng các nút.
- Liên kết mở trực tiếp repository GitHub.

## 8. Lưu trữ, Clear và xóa database

### Dữ liệu được giữ lâu dài

- Mua Hàng;
- Nhập Kho;
- Xưởng Gia Công;
- liên kết đổi mã PR;
- Job Code tích hợp.

### Clear dữ liệu phiên

Nút **Clear dữ liệu phiên** chỉ xóa dữ liệu Quét Mã, dữ liệu gốc của Quét Mã, các lựa chọn xác nhận và kết quả đối chiếu của phiên. Mua Hàng, Nhập Kho và Xưởng Gia Công vẫn được giữ nguyên.

### Xóa toàn bộ cơ sở dữ liệu

Trang **Quản lý cơ sở dữ liệu** yêu cầu ba bước xác nhận và từ khóa `XÓA`. Phần mềm tạo backup cuối trước khi xóa Mua Hàng, Nhập Kho, XGC, Quét Mã và liên kết đổi mã. Job Code tích hợp vẫn được giữ.

Dữ liệu desktop nằm trong thư mục `userData/data` do Electron quản lý. Bản gốc file Mua Hàng và các bản backup JSON được lưu trong thư mục dữ liệu này.

## 9. Kiểm tra dữ liệu có khớp hay không

Trang **Kiểm tra dữ liệu khớp** đối soát trực tiếp dữ liệu thật đang nạp. Sau khi nạp file, nhấn **Kiểm tra dữ liệu đang nạp** để xem từng mã.

Báo cáo hiển thị:

- mã dự án;
- mã trong Quét Mã;
- mã được ghép ở Mua Hàng;
- mã được ghép ở Nhập Kho/XGC;
- số lượng của cả ba nguồn;
- cách ghép: chính xác, hậu tố `_GC`, gần đúng, xác nhận thủ công hoặc không tìm thấy;
- giải thích nguyên nhân.

Rê chuột vào Mã Quét, Mã Mua Hàng hoặc Mã Nhập Kho/XGC để xem nhanh tên file, sheet và số dòng nguồn. Nút **Tìm mã** tìm mã đó trong toàn bộ file đã nạp, đồng thời nhận cả mã tương ứng chỉ khác hậu tố `_GC`. Kết quả tìm kiếm liệt kê nguồn, mã, file, sheet, dòng, số lượng và cho biết mã có xuất hiện nhiều lần hay không.

Mỗi dòng được phân loại:

- `KHỚP`: mã và số lượng ba nguồn đều khớp;
- `CHÊNH LỆCH`: mã ghép tin cậy nhưng số lượng giữa các nguồn khác nhau;
- `CẦN KIỂM TRA`: không có nguồn tương ứng, ghép gần đúng/thủ công, thiếu Quét Mã, thiếu Mua Hàng hoặc thuộc trường hợp `PU Check`.

Kết quả có thống kê tổng và phân trang 100 dòng. Chức năng chỉ đọc dữ liệu phiên hiện tại, không thay đổi database.

Phần **Kiểm tra kỹ thuật của phần mềm** nằm bên dưới báo cáo dữ liệu. Phần này chạy các tình huống mẫu độc lập và hiển thị từng mục `ĐẠT` hoặc `KHÔNG ĐẠT`.

Bộ kiểm tra xác minh:

1. tệp cốt lõi và Job Code tích hợp;
2. cấu hình desktop và GitHub Update;
3. đối chiếu mã chính xác và số lượng;
4. quy tắc hậu tố `_GC`;
5. quy tắc Note `PU Check` trong Excel;
6. thêm/cập nhật Mua Hàng và lưu XGC bằng database tạm.

Dữ liệu thử được tạo trong thư mục tạm rồi tự xóa, không thay đổi dữ liệu thật.

```powershell
npm run verify
```

## 10. Kiểm thử dành cho phát triển

Kiểm thử desktop:

```powershell
npm test
npm run check
npm run verify
```

Kiểm thử web không chạy mặc định. Chỉ chạy khi chủ động yêu cầu:

```powershell
npm run test:web
npm run check:web
```

## 11. Build, commit và GitHub

### Chỉ build Windows portable

```powershell
npm run dist
```

File build nằm trong thư mục `dist` và không được commit lên Git.

### Test + tự kiểm tra + build portable + commit + push

```powershell
npm run publish -- "Nội dung cập nhật"
```

Lần đầu chưa có remote GitHub:

```powershell
npm run publish -- "Khởi tạo dự án" "https://github.com/pokemon1742000-commits/PU.git"
```

Script tự kiểm tra Git repository, remote và danh tính tác giả commit; sau đó chạy test, kiểm tra cú pháp, tự kiểm tra ứng dụng, build, commit và push nhánh hiện tại.

### Phát hành bản cập nhật có Setup

```powershell
npm run release:auto -- "Nội dung phiên bản"
```

Lệnh này:

1. tăng phiên bản vá hoặc tiếp tục phiên bản đang phát hành dở;
2. chạy test, kiểm tra cú pháp và tự kiểm tra;
3. build bộ cài NSIS;
4. commit và tạo tag phiên bản;
5. push nhánh `main` và tag;
6. tạo GitHub Release;
7. tải lên file Setup, `.blockmap` và `latest.yml`;
8. kiểm tra kích thước/hash bộ cài trước khi phát hành.

Máy phát hành cần cài GitHub CLI và đăng nhập:

```powershell
gh auth login
```

## 12. Cập nhật ứng dụng

Nút **Update** kiểm tra phiên bản mới tại GitHub Releases. Khi có bản mới, ứng dụng tải xuống, đóng, cài đặt và mở lại.

Cơ chế tự cập nhật được thiết kế cho bản cài Setup do `release:auto` tạo. GitHub Release phải có đủ:

- `Doi-Chieu-Setup-x.y.z.exe`;
- `Doi-Chieu-Setup-x.y.z.exe.blockmap`;
- `latest.yml`.

## 13. Chế độ web tùy chọn

Web không phải chế độ chạy mặc định. Chỉ dùng khi có nhu cầu riêng:

```powershell
npm run start:web
```

Mặc định máy chủ chạy tại `http://localhost:3000`. Có thể cấu hình:

```powershell
$env:PORT=8080
$env:HOST="127.0.0.1"
$env:APP_DATA_DIR="D:\doi-chieu-data"
npm run start:web
```

- `PORT`: cổng, mặc định `3000`.
- `HOST`: địa chỉ lắng nghe, mặc định `0.0.0.0`.
- `APP_DATA_DIR`: thư mục dữ liệu máy chủ, mặc định là `data` trong dự án.

Bản web tĩnh `standalone/index.html` là nhánh chức năng riêng và chỉ được tạo lại khi chủ động chạy:

```powershell
npm run build:web
```

## 14. Cấu trúc mã nguồn chính

| Đường dẫn | Vai trò |
|---|---|
| `main.js` | Tiến trình Electron, IPC, phiên làm việc và cập nhật ứng dụng |
| `preload.js` | API an toàn giữa giao diện và Electron |
| `src/processor.js` | Đọc Excel, chuẩn hóa, ghép mã và phân loại |
| `src/storage.js` | Lưu database JSON, raw data và backup |
| `src/exporter.js` | Tạo báo cáo Excel |
| `src/data-audit.js` | Kiểm tra độ khớp của dữ liệu thật đang nạp |
| `src/self-check.js` | Bộ tự kiểm tra kỹ thuật bằng dữ liệu mẫu |
| `renderer/index.html` | Cấu trúc giao diện |
| `renderer/app.js` | Điều khiển thao tác giao diện |
| `renderer/styles.css` | Giao diện và chủ đề màu |
| `scripts/publish.ps1` | Build portable, commit và push |
| `scripts/release-auto.ps1` | Phát hành Setup và GitHub Release |
| `test/` | Kiểm thử tự động |

## 15. Giới hạn của bộ tự kiểm tra

Kết quả `ĐẠT` xác nhận các quy tắc đã được mô hình hóa đang hoạt động đúng với dữ liệu thử. Nó không thể bảo đảm mọi file Excel ngoài thực tế đều có bố cục chuẩn. Khi file nguồn thay đổi tên cột, vị trí cột hoặc định dạng dữ liệu, cần kiểm tra trang **Cảnh Báo** và **Xem file gốc**.
