# Đối Chiếu Dữ Liệu Mua Hàng

Ứng dụng Electron dành cho Windows, dùng để nhập và đối chiếu dữ liệu **Mua Hàng**, **Quét Mã**, **Nhập Kho** và **Xưởng Gia Công**, sau đó xuất báo cáo Excel theo mẫu `SỐ LIỆU XUẤT KHO`.

- Phiên bản hiện tại: **v1.0.25**
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

Ứng dụng dùng module native `better-sqlite3`, nên cần bản biên dịch riêng cho Node.js khi chạy test và cho Electron khi chạy ứng dụng. Các lệnh `npm test` và `npm start` tự động chọn đúng bản biên dịch tương ứng. Hai lệnh này không nên chạy đồng thời: mỗi lần rebuild sẽ thay thế file native dùng chung trong `node_modules`.

Nếu cần chạy thủ công sau khi đổi runtime:

```powershell
npm run rebuild:node
npm run rebuild:electron
```

`npm run rebuild:node` phục vụ các lệnh Node.js như test; `npm run rebuild:electron` phục vụ ứng dụng desktop. Nếu gặp lỗi `NODE_MODULE_VERSION`, hãy đóng ứng dụng rồi chạy lại lệnh rebuild phù hợp.

## 1.1. Quy trình nhanh cho người dùng lần đầu

Thực hiện theo đúng thứ tự dưới đây để có một báo cáo hoàn chỉnh:

1. Nhấn **Tổng hợp PR**, chọn file Mua Hàng và các sheet cần nạp.
2. Nhấn **Tổng hợp tình hình nhận hàng**, chọn file Nhập Kho.
3. Nếu có gia công ngoài, nhấn **Tổng hợp đơn hàng sản xuất** để nạp Xưởng Gia Công.
4. Nhấn **Xuất kho (Quét mã)**, chọn file Quét Mã và sheet tương ứng. Đây là bước kích hoạt đối chiếu.
5. Mở tab **Xác Nhận**, chọn ứng viên đúng rồi nhấn **Ghép**; mã không đúng thì **Bỏ qua**.
6. Kiểm tra lần lượt **Đủ Hàng**, **Thiếu** và **Thừa**; dùng ô tìm kiếm để lọc theo dự án/mã hàng.
7. Mở **Quản lý cơ sở dữ liệu** và nhấn **Kiểm tra dữ liệu đang nạp** nếu cần đối soát từng mã.
8. Nhấn **Xuất Excel**, chọn **So sánh PU**, **PR vs PO + XGC** hoặc cả hai, rồi xác nhận xuất file.

Dữ liệu Mua Hàng, Nhập Kho, Xưởng Gia Công và Job Code được lưu dài hạn trong SQLite. **Clear dữ liệu phiên** chỉ dành cho Quét Mã và các lựa chọn xác nhận của phiên hiện tại; không dùng nút này để xóa dữ liệu tích lũy.

Tab **i → Hướng dẫn sử dụng** trong phần mềm có ảnh minh họa giao diện thật, khung vuông chỉ đúng vị trí cần nhấn và hướng dẫn riêng cho từng chức năng.

## 2. Các nguồn dữ liệu

Phần mềm hỗ trợ file `.xlsx` và `.xlsm`, có thể chọn nhiều file và nhiều sheet trong một lần nạp. Hàng tiêu đề được tìm trong 30 dòng đầu của mỗi sheet.

### 2.1. Dữ liệu Mua Hàng

Dùng làm số lượng chuẩn để đối chiếu.

| Cột trong file nguồn | Ý nghĩa trong phần mềm |
| --- | --- |
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
| --- | --- |
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
| --- | --- |
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
| --- | --- | --- |
| Không có Mua Hàng nhưng có Quét Mã hoặc Nhập Kho/XGC | `Check lại` | `PU check` |
| SL quét mã ≥ SL mua hàng | `OK` | Để trống |
| SL quét mã < SL mua hàng và SL nhập kho = 0 | `Chưa về` | NCC nếu đã có đơn; nếu chưa có thì `PU check` |
| SL nhập kho < SL mua hàng | `Chưa về đủ` | NCC hoặc `PU check` |
| SL nhập kho ≥ SL mua hàng nhưng số lượng quét còn thiếu | `Chưa bắn code` | `Kho` |

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

### 7.1. Bản đồ nút và trang chức năng

| Nút/trang | Dùng để làm gì | Dữ liệu bị thay đổi |
| --- | --- | --- |
| **Tổng hợp PR** | Nạp hoặc cập nhật Mua Hàng | SQLite dài hạn của Mua Hàng |
| **Xuất kho (Quét mã)** | Nạp dữ liệu quét và khởi động đối chiếu | Dữ liệu phiên Quét Mã |
| **Tổng hợp tình hình nhận hàng** | Nạp/cập nhật số lượng Nhập Kho | SQLite dài hạn của Nhập Kho |
| **Tổng hợp đơn hàng sản xuất** | Nạp/cập nhật báo cáo XGC | SQLite dài hạn của Xưởng Gia Công |
| **Xác Nhận** | Quyết định mã gần đúng theo từng nguồn | Lựa chọn xác nhận của phiên |
| **Đủ Hàng / Thiếu / Thừa** | Kiểm tra nhóm kết quả sau đối chiếu | Không tự sửa dữ liệu nguồn |
| **Đổi mã duyệt PR** | Liên kết mã cũ với mã mới theo dự án | Bảng liên kết đổi mã |
| **Xem Job Code** | Tra cứu danh sách Job Code tích hợp | Chỉ đọc |
| **Quản lý cơ sở dữ liệu** | Đối soát, tự kiểm tra, backup/restore và xóa có bảo vệ | Tùy nút được chọn |
| **Clear dữ liệu phiên** | Bắt đầu lại phần Quét Mã/xác nhận | Chỉ xóa dữ liệu phiên |
| **Update** | Kiểm tra và cài bản latest đã tải | Không đổi dữ liệu nghiệp vụ |
| **Restore** | Cài bản stable ngay trước latest để khôi phục chương trình | Không xóa dữ liệu SQLite |
| **Xuất Excel** | Tạo workbook báo cáo từ kết quả hiện tại | Tạo file mới |

Khi hộp **Chọn sheet cần nạp** xuất hiện, mỗi file có thể chọn nhiều sheet. Bỏ chọn sheet không liên quan trước khi nhấn **Nạp sheet đã chọn**; nếu không chọn sheet nào, phần mềm không chạy import. Sau khi nạp, các bảng nguồn có thể chuyển giữa dữ liệu đã gộp và **Xem file gốc** bằng biểu tượng con mắt.

## 8. Lưu trữ SQLite, Clear và xóa database

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

Dữ liệu desktop nằm trong file `userData/data/app.sqlite` do Electron quản lý. Khi nâng cấp, các file JSON cũ được chuyển an toàn vào `userData/data/legacy-json-backup/` và không bị xóa tự động. File Excel gốc vẫn nằm trong `original-files/`; backup là snapshot SQLite trong `backups/`. Trang **Quản lý cơ sở dữ liệu** cho phép tải danh sách snapshot hợp lệ và khôi phục một backup; trước khi khôi phục, trạng thái hiện tại cũng được lưu thành backup mới. Nếu file SQLite bị mất nhưng còn snapshot hợp lệ, phần mềm tự khôi phục snapshot mới nhất thay vì mở database rỗng.

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

Repository hiện chỉ duy trì đường chạy Electron desktop. Các script và test web/standalone cũ đã được loại bỏ vì không còn mã thực thi tương ứng.

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

Nút **Update** kiểm tra phiên bản mới nhất tại GitHub Releases. Khi có bản mới, ứng dụng tải xuống và hỏi xác nhận trước khi cài đặt, đóng rồi mở lại.

Nút **Restore** tìm bản stable được phát hành ngay trước bản latest trên GitHub, tải đúng bộ cài Setup của bản đó và hỏi xác nhận trước khi hạ phiên bản. Restore chỉ khôi phục **chương trình**, không phải khôi phục snapshot dữ liệu; dữ liệu SQLite trong `userData/data` không bị xóa. Nếu không có đủ hai bản stable, bản trước không cũ hơn phiên bản đang chạy, hoặc release thiếu bộ cài hợp lệ, thao tác sẽ dừng và không thay đổi ứng dụng.

Cơ chế tự cập nhật và Restore được thiết kế cho bản cài Setup do `release:auto` tạo. GitHub Release phải có đủ:

- `Doi-Chieu-Setup-x.y.z.exe`;
- `Doi-Chieu-Setup-x.y.z.exe.blockmap`;
- `latest.yml`.

## 13. Phạm vi chạy

Phiên bản hiện tại tập trung vào ứng dụng desktop Electron. Các script web/standalone cũ đã được loại bỏ vì không còn mã thực thi tương ứng; toàn bộ luồng lưu trữ chính dùng SQLite trong thư mục `userData/data`.

## 14. Cấu trúc mã nguồn chính

| Đường dẫn | Vai trò |
| --- | --- |
| `main.js` | Tiến trình Electron, IPC, phiên làm việc và cập nhật ứng dụng |
| `preload.js` | API an toàn giữa giao diện và Electron |
| `src/processor.js` | Đọc Excel, chuẩn hóa, ghép mã và phân loại |
| `src/storage.js` | SQLite database, migration, raw data và backup snapshot |
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
