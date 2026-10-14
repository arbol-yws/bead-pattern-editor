# 拼豆图纸绘画板

独立的静态网页工具：上传一张图片，在图片上叠加网格并使用 MARD 色号填色，最后导出与当前项目图纸 JSON 兼容的数据。

## 打开

在当前目录执行：

```bash
python3 -m http.server 4173 -d bead-pattern-editor
```

浏览器打开 `http://localhost:4173`。

## 导出格式

导出的 JSON 包含项目现有的 `rows`、`cols`、`brand`、`grid`、`palette`、`total_beads`、`blank_cells` 字段，同时保留 `cells` RGB 矩阵，空白格为 `[]`，`grid` 中空白格为 `""`。
