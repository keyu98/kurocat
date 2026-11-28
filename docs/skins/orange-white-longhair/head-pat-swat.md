# 摸头挥爪彩蛋（DEV-156）

在猫咪头部来回抚摸，默认有 25% 概率抬起右前爪挥一下。右键菜单「摸头挥爪概率」可选关闭、25%、50%、100%；也可以通过 MCP `update_settings` 或 `settings.json` 将 `headPatSwatChance` 设为任意 0～1 数值。旧配置自动补为 0.25。

![2D 与 3D 实际渲染，左 2D、右 3D](head-pat-swat.gif)

## 原有交互与接入方式

- 桌面端通过 `kuro-cursor` 将归一化光标位置和粗略 `overCat` 判定传给渲染器。鼠标左键用于原生拖窗，保持原有行为；此次彩蛋由抚摸触发。
- 2D 在 `src/catEngine.ts` 的 `onWindowCursor` 中累计来回抚摸，达到两次反向移动后增加 `petEnergy`，驱动眯眼和呼噜。猫、前爪、键盘均由 Canvas 实时绘制；发财外观配置位于 `src/assets/orange-white-longhair/skin.json`，原先没有摸头 PNG 序列帧。
- 3D 在 `src/catEngine3d.ts` 中由 `petting` / `petUntil` 驱动眯眼呼噜，网页路径使用头部射线检测；桌面原路径使用粗略 `overCat`。此次统一对桌面与网页的挥爪检测使用实际头部射线；3D 继续使用原长毛模型及其前爪、毛色、纹理。
- `src/headPatSwat.ts` 共享手势、抽签、冷却及动作关键姿势。2D 先将光标换算到当前视口，再检测随脊柱变形的头部椭圆，因此缩放和 108 键布局仍能正确判定。

## 播放与互斥

有效抚摸需要至少两次 14 逻辑像素的反向移动，过滤静止悬停、抖动、单次路过和大幅瞬移。一次抽签后冷却 3 秒，普通反应也占用冷却，避免连续移动迅速把 25% 变成必触发。挥爪播放 780ms，抬爪 → 露肉垫 → 横挥 → 收爪，结束后交还原来的前爪状态。

挥爪期间暂停普通眯眼呼噜；隐私模式、拖动/鼠标按住、打字按键按住、尾巴选键不启动新挥爪。隐私模式、切换角色、停止渲染会取消动作。默认猫与其他猫使用原有颜色的程序绘制前爪；大肥鱼不参与。原生透明窗口和置顶设置没有改动。

## 生成素材

成品：`src/assets/orange-white-longhair/swat-paws.png`，RGBA PNG，768×128，六个 128×128 帧，横向排列。内置 imagegen 以现有发财 2D 游戏帧作参考，一次生成六帧白手套分层素材，再进行同一比例缩放、底部居中锚点对齐和 alpha 边缘整理。此运行未安装 sprite-pipeline 配套脚本，使用浏览器 Canvas 完成相同的裁切与规范化步骤。主体由现有渲染器继续绘制，保留鼻旁橘斑、白鼻梁、白毛领和橘色尾巴。已打开检查最终图集和实际渲染帧。

生成提示词：

```text
Use case: precise-object-edit. Asset type: production 2D game animation paw sprite atlas.
The input image is the approved in-game orange-white cat; use it only as style and palette reference.
Create ONE complete animation atlas of ONLY the cat's isolated cream-white mitten paw tips (no cat body, no arms, no keyboard).
Exact SIX frames in a uniform 3-column by 2-row grid, read left to right then next row.
Every square slot contains one paw centered at the SAME center and same scale; generous transparent padding, no overlap.
The animation is a playful quick swat toward the viewer: frame 1 relaxed rounded closed mitten viewed from above,
frame 2 wrist rotates revealing pink pads, frame 3 spread soft toes palm facing viewer at strike anticipation,
frame 4 fully extended soft white paw with four round toes and small dusty-pink pads facing viewer at swat impact,
frame 5 paw rotating back, frame 6 relaxed closed mitten again.
Paw tip only, no long foreleg; tiny wrist at bottom is fine.
Match the reference's SIMPLE smooth 2D Canvas cartoon graphics: flat warm ivory white #fff7e9,
pale beige soft underside #f3e8d6, subtle thin warm beige #b59b82 contour,
rounded chubby silhouette, gentle minimal shading.
Same character, same palette family, same silhouette family, same facing direction,
same paw size and outfit proportions across all six frames.
Actual transparent background, clean alpha, no checkerboard drawn into image, no scenery,
no labels, no text, no poster layout, no claws, no human hands.
This is a consistent animation strip in a 3x2 atlas, not concept art.
```

后续编辑提示要求保持六帧形状、颜色、尺寸和排列，仅去除外部光晕及阴影并保留透明背景。最终规范化时统一处理残留低 alpha 外阴影，未用代码绘制替代生成素材。

## 验证与复现

```bash
npm ci
npm run test:swat
npx playwright install chromium
npm run test:swat:browser
npm run build
npm run build:facai
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

如已有 Chromium，可通过 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 指定可执行文件。浏览器检查自行启动/停止本工作树的 Vite，使用 1456 端口；加 `-- --capture` 会将 30 帧 2D 和 30 帧 3D PNG 写入已忽略的 `artifacts/head-pat-swat/`。动画录制用 100% 概率触发，再按确定时间点采样，概率边界另由单元测试验证。

已验证：6 项手势/概率/冷却单元测试；2D／3D 真实渲染器中的头部触发、腹部排除、关闭/必触发、呼噜互斥、隐私中断与结束恢复；2D 正常抚摸保留、默认猫、大肥鱼排除、缩放及 108 键布局；3D 桌面与网页两条指针路径；Canvas 透明角像素与 WebGL alpha；页面零异常。标准版和发财专版前端构建通过，Vite 保留原有大 chunk 提示。

Rust `cargo test --locked`：23 项通过，1 项既有联网测试忽略；新增旧配置默认值/概率边界测试通过。`cargo build --locked` 原生开发构建通过，保留已有 Linux 警告。Linux Xvfb + Openbox 中启动真实 Tauri 程序，确认 420×440 窗口已映射、深度 32（支持 alpha）、`_NET_WM_STATE_ABOVE` 置顶属性生效；检查后已停止全部测试进程。此检查验证窗口属性，动作内容由上面的浏览器渲染测试验证。Windows／macOS 的真实桌面置顶和透明合成尚未实机复验。
