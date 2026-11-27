# KuroCat 的落地示例

以下路径和命令从 KuroCat 仓库根目录使用。发财的显示名为「发财」，现有皮肤 ID 是 `orange-white-longhair`。改名时保留 ID，以便已有配置能继续找到皮肤。

## 参考照片和 3D 验收

- `docs/skins/orange-white-longhair/` 中的两张 `reference-*-original.jpg` 是沿用的原始样图。`preview.png`、`side.png`、`sleep-side.png` 和 `typing.png` 对应渲染预览。
- 发财案例使用现有大橘猫作为体态、脸部朝向和侧面轮廓的参照。保留照片里的橘色背部、橘白脸纹和白胸，眼睛圆润。用户说的「发腮」指白脸颊向白胸平滑延伸，前颈和后颈在侧面都要顺畅，身材沿用已确认的比例。
- `src/assets/orange-white-longhair/skin.json` 是共享皮肤数据，`src/longhair3d.ts` 实现模型、毛色和姿态变形。`src/catEngine3d.ts` 接入 3D 角色，`src/catEngine.ts` 处理桌宠状态和渲染入口。网站皮肤列表和试玩分别在 `website/src/builtinCats.ts` 与 `website/src/main.ts`。
- `npm run build` 构建普通桌面前端，`npm run build:web` 构建网站试玩页。预览实际产物，在相同镜头下对照侧面，再让猫进入真实睡眠状态看两条颈部轮廓。发财的睡眠修复作用于后颈局部深度和睡眠时的头部位置，查看 `uNeckFill` 与 `headMount.position`。

## 专版入口

- `npm run build:facai` 生成专版前端 `dist-facai/`。Vite 的 `facai` 模式与 Rust 的 `facai-only` feature 配对。核对主窗口、菜单和 OBS 预览使用同一个皮肤 ID。`src/catSkins.ts` 和 `src-tauri/src/cats.rs` 是前后端目录入口，`src-tauri/src/config.rs` 处理首次启动、旧设置和独立配置目录。
- `src-tauri/tauri.facai.json` 设置独立的应用 ID、产物名、前端目录和图标。Windows 和 macOS 分别使用独立的注册表启动项与 LaunchAgent。发财专版关闭普通版更新、MCP 和自定义皮肤入口，保留桌宠交互与 OBS。

## Windows 单文件

```sh
npm ci
npm run tauri:build:facai
```

使用 Windows MSVC Rust 目标、Visual Studio C++ 工具链和 Windows SDK。构建命令使用 `--no-bundle`，从 CLI 报出的路径取得 `Facai.exe`。默认输出是 `src-tauri/target/x86_64-pc-windows-msvc/release/Facai.exe`，设置了 `CARGO_TARGET_DIR` 时以 CLI 报出的路径为准。复制成给用户的单文件，例如 `发财.exe`，核对 SHA-256。运行端使用系统的 WebView2。

用隔离的 `APPDATA` 和 WebView2 数据目录启动交付文件。检查全新配置与已有其他角色 ID 的配置，确认两者均启动为发财，且皮肤列表只有发财。可在隔离配置中启用 OBS 后用本机 `/obs/state` 核对后端，再从桌面 WebView 或界面检查实际的 3D 显示。

## macOS 通用 DMG

```sh
npm ci
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm run tauri:build:facai:macos
```

在具备 Xcode 命令行工具的 Mac 或获准使用的 macOS CI runner 上构建。`src-tauri/tauri.facai.macos.json` 为专版开启 App bundle，并指定 macOS 图标。结果是 `src-tauri/target/universal-apple-darwin/release/bundle/macos/发财.app`。

- 复用 `.github/workflows/facai-macos.yml` 的签名与封装步骤。先从 `Info.plist` 读取实际可执行文件和应用 ID，再运行 `lipo "$executable_path" -verify_arch arm64 x86_64`。路径必须放在 `-verify_arch` 前面。
- 通过 `scripts/macos-codesign.sh` 签名。将签好的 App 和指向 `/Applications` 的链接放到临时目录，用 `hdiutil` 制作 DMG。用同一脚本挂载成品并验证其中的应用签名，输出 SHA-256。
- Windows 工作区可使用分支上的 GitHub Actions 构建。从成功的运行下载对应产物，核对下载文件的 SHA-256 与 runner 输出。提供本地链接，跨设备取用时也可附上 CI 下载链接并说明保留期限。
- 个人试用可用 ad hoc 签名，交付时说明 Apple 公证状态。能做实机启动测试时，记录启动与交互结果。CI 的双架构和验签检查属于安装包验证。
