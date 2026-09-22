// ============================================================
// 印前检查宿主脚本
// 运行于 Illustrator ExtendScript 环境,由 CEP 面板调用
// 入口函数: runPreflight()  返回 JSON 字符串
// ------------------------------------------------------------
// v3.7: 扫描核心重构为"图层→组→对象"一次树遍历(见 runPreflight 内注释):
//       隐藏图层/隐藏组的整棵子树直接跳过,可见性沿树向下传递,
//       不再逐对象沿 parent 链向上爬,每类对象独立扫描配额。
// v3.6: ① 油墨不再对复合路径组件重复统计 ② 矢量链接跳过分辨率检查
//       ③ 隐藏统计每类独立配额
// v3.5: ① 系统字体表缓存到全局 ② 移除文档出血解析死代码
//       ③ 文本框纳入出血测量 ④ 无位图时跳过 XMP 解析
//       ⑤ 出血测量 bounds 先行
// v5.9: 删除 runPreflight 内未使用的文档级 placedItems 变量(死代码)
// v5.10: 新增缺失字体诊断量(res.fontDiag)——系统字体表条目数/可用标志、
//        文档字体(doc.textFonts)判缺数、文本框口径判缺数、混合字体帧数,
//        用于真机定位"该报缺失却不报"的原因;不影响任何判定结果。
// v5.11: 诊断追加文档级文本框口径(doc.textFrames 全集,含隐藏/锁定,前 300 帧)——
//        与树遍历名单对比,判断缺失字体是否藏在树遍历扫不到的地方(符号内/插件外壳)。
// v5.12: 字体表条目同步记录 family/style,诊断下发"命中明细"——文档里出现的
//        每个字体名及其表内 family/style。用于甄别"缺失字体占位条目":
//        AI 会把文档引用的缺失字体也放进 app.textFonts(仅名字可用,family/style
//        常为空),导致 v5.8 起表跟随刷新后缺失字体被误判为"已安装"。
// v5.13 修复: 缺失字体被占位条目"洗白"——真机确认 zihunxinyanghei 以占位条目
//        (family=名字,无 style)存在于 app.textFonts,v5.8 起表跟随刷新后不再报。
//        现在建表时给占位条目打 ph 标记(无 style 且 family 为空/等于名字),
//        缺失判定改为"不在表里或仅为占位条目都算缺失";真激活字体(有
//        family/style)不受影响,v5.8 的"激活后不再误报"行为保持。
// v5.14: 前端修复——字体卡徽标"未转曲 N 个"与"缺字体 N"由三目二选一改为
//        并列双徽标(转曲状态主徽标 + 缺失字体副徽标),jsx 仅构建号跟随。
// v5.15 新增: ① 极小字号检测——字号 < 6pt(≈2.12mm)的文字印刷易糊/断笔,
//        树遍历文本框分支顺带读 size,样本记文字内容+字号,并入字体卡底部;
//        ② 缺失链接检测——链接图源文件 file.exists === false 时计入缺失,
//        清单条目带 missing 标记,并入图片嵌入卡。
// v5.16 精简: v5.10~v5.12 的诊断量(res.fontDiag/文档级扫描/命中明细/前端
//        诊断行)随根因确诊整体移除;占位条目过滤与极小字号徽标保留。
// v5.17: 前端精简——缺失字体括号说明与"检测方式"灰字、极小字号小标题与
//        建议灰字按用户要求移除,jsx 仅构建号跟随。
// v5.19 精简: ① 隐藏图层名单封顶 10→6 ② 分辨率样本封顶 15→8(前端字体名单
//        15→8 同步);③ 前端链接图清单两行并一行(路径移到悬停)。
// v5.21 新增: 隐藏文字统计——doc.textFrames 全集(含隐藏,封顶 500 帧)逐帧用
//        pfBlockInfo 判可见性,隐藏帧单独计数(hiddenText),字体名并入涉及
//        字体与缺失检测;可见文字口径不变。
// v6.8: 极小字号分两级——<6pt 计 1 处(黄色提示),其中 <5pt 再计 badCount
//        (红色提示)。badCount 嵌套在 count 之内;样本仍只按 <6pt 收,不重复列。
// v8.3 新增: 叠印(Overprint)检查 —— 卡6 加"叠印"分块(计数标红) + 右上角红徽标"有叠印"。
//        ① 图形(PathItem/CompoundPathItem): 读 pageItem 级 fillOverprint / strokeOverprint;
//        ② 文字(TextFrame): **真机实测(AI 28.0.0) pageItem 级这两个属性"不存在"**
//           ⇒ 只能读字符级 textRange.characterAttributes.overprintFill / overprintStroke;
//        ③ 每一次读取都包 try/catch,读不到/抛异常一律当 false —— 绝不抛、绝不误报;
//        ④ 分块排在"色版1~4%"之后、"描边<0.1mm"之前,与卡片新名
//           `油墨 · 叠印 · 描边粗细` 同序;叠印数**不并入主徽标计数**,只走 extraChip。
// ============================================================

// ExtendScript 无原生 JSON,且读取未声明的 JSON 标识符会直接报错,
// 因此使用独立命名的序列化函数,彻底绕开 JSON 标识符
function pfStringify(value) {
  function esc(s) {
    return String(s)
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\r/g, "\\r")
      .replace(/\n/g, "\\n")
      .replace(/\t/g, "\\t");
  }
  function ser(v) {
    if (v === null || v === undefined) return "null";
    var t = typeof v;
    if (t === "number") {
      // NaN / Infinity 不是合法 JSON,转成 null 防止前端解析失败
      if (isNaN(v) || !isFinite(v)) return "null";
      return String(v);
    }
    if (t === "boolean") return String(v);
    if (t === "string") return '"' + esc(v) + '"';
    if (v instanceof Array) {
      var a = [];
      for (var i = 0; i < v.length; i++) a.push(ser(v[i]));
      return "[" + a.join(",") + "]";
    }
    var parts = [];
    for (var k in v) {
      if (v.hasOwnProperty(k)) parts.push('"' + esc(k) + '":' + ser(v[k]));
    }
    return "{" + parts.join(",") + "}";
  }
  return ser(value);
}

// JSX 构建号: 随每次改动递增,并随每个返回值下发。
// 前端据此判断 ExtendScript 引擎里加载的是否为当前版本:
// 版本一致 → 跳过 $.evalFile 直接调用函数(省掉每次重载 28KB 脚本);
// 不一致/不存在 → 强制重载一次。这样开发期改完 JSX 无需重启 AI。
// v7.2: 仅随版本号递增(本版为面板文案一致化,检测逻辑与返回结构零改动)。
var PF_BUILD = "8.3";

var PT2MM = 0.3527777778;     // 1 pt = 0.3528 mm
var MAX_SCAN = 3000;          // 每类对象最多扫描数量(防大卡死)
var BLEED_MIN_MM = 3;         // 实际出血不足此值(mm)时提示露白风险
var TINY_PT = 6;              // v5.15: 字号低于此值(pt)判为极小字号(印刷易糊,黄色)
var TINY_BAD_PT = 5;          // v6.8: 字号低于此值(pt)判为极小字号·重度(红色)
var THIN_STROKE_MM = 0.1;     // v6.1: 描边宽 <0.1mm 判为过细(印刷易断线/丢失)
var LIGHT_CH = 5;             // v6.1: CMYK 某分量 0<值<5 判为色值极浅(色版不稳定)
var SAMPLE_CAP = 5;           // v7.8: 油墨类采样条数上限(**按不同值计**,同值只占 1 条并累加 n)

function pfRound(v) { return Math.round(v * 10) / 10; }

// ---- 计算四色油墨总量 C+M+Y+K; 返回 {total, type, desc} ----
//     total<0 表示非 CMYK 类(无法按四色相加判断)
function pfInkSum(c) {
  if (!c) return null;
  var tn = "";
  try { tn = c.typename; } catch (e) { return null; }

  if (tn === "CMYKColor") {
    var cy = Math.round(c.cyan), mg = Math.round(c.magenta),
        yl = Math.round(c.yellow), bk = Math.round(c.black);
    // v8.0: 分档用**原值**求和 —— 逐分量取整再相加会在 220/300 阈值附近偏 ±2(最多四个 0.5),
    //       把临界对象分错级(如 219.6+0.0+0.0+0.0 取整成 220 被误判"偏重")。
    //       desc 仍用取整后的分量(显示口径不变),前端显示 "= 总量" 时再统一四舍五入。
    var total = c.cyan + c.magenta + c.yellow + c.black;
    return { total: total, type: "cmyk", desc: "C" + cy + " M" + mg + " Y" + yl + " K" + bk };
  }
  if (tn === "GrayColor") {
    var g = Math.round(c.gray);
    return { total: c.gray, type: "cmyk", desc: "K" + g };   // v8.0: 同上,用原值分档
  }
  if (tn === "RGBColor") {
    var r = Math.round(c.red), gg = Math.round(c.green), b = Math.round(c.blue);
    return { total: -1, type: "rgb", desc: "RGB(" + r + "," + gg + "," + b + ")" };
  }
  if (tn === "SpotColor") {
    var sn = "";
    try { sn = c.spot.name; } catch (e2) {}
    return { total: -1, type: "spot", desc: "专色 " + sn };
  }
  // GradientColor / PatternColor / NoColor 等不判断
  return null;
}

// 文本框填充色(混合颜色时 ExtendScript 会抛异常)
function pfTextInk(tf) {
  try { return pfInkSum(tf.textRange.characterAttributes.fillColor); }
  catch (e) { return { total: -1, type: "mixed", desc: "混合颜色" }; }
}

function pfSnippet(tf) {
  try {
    var s = tf.contents;
    s = s.replace(/[\r\n\t]+/g, " ");
    if (s.length > 12) s = s.substring(0, 12) + "...";
    return '"' + s + '"';
  } catch (e) { return "(文本)"; }
}

// v6.2: 取对象名(带引号),无 name 返回 "" —— 样本改结构化后由前端拼装展示
function pfObjName(it) {
  try { if (it.name && it.name !== "") return '"' + it.name + '"'; } catch (e) {}
  return "";
}

// v6.1: CMYK 色值极浅检测——某分量四舍五入后 0<值<5 返回该色说明,否则 null。
//   按四舍五入后的整数判断(与面板显示一致,如 C4.6 显示 C5 即不判);
//   恰为 0 的分量不算(纯色/纯黑不误报)。Gray 不判(仅按用户口径判 CMYK)。
function pfLightChannel(c) {
  if (!c) return null;
  var tn = "";
  try { tn = c.typename; } catch (e) { return null; }
  if (tn !== "CMYKColor") return null;
  var v = [Math.round(c.cyan), Math.round(c.magenta), Math.round(c.yellow), Math.round(c.black)];
  for (var i = 0; i < 4; i++) {
    if (v[i] > 0 && v[i] < LIGHT_CH) return "C" + v[0] + " M" + v[1] + " Y" + v[2] + " K" + v[3];
  }
  return null;
}

// v8.3: 叠印读取——一律包 try/catch,读不到属性 / 属性不存在 / 抛异常 全部当 false。
//   不写成 obj[prop] 泛读是因为 Adobe 宿主对象对中括号取值偶有怪癖,显式写更稳。
//   图形侧(pageItem 级)与文字侧(字符级)各两个,共四个。
function pfOvpFill(obj) {
  try { return (obj.fillOverprint === true); } catch (e) { return false; }
}
function pfOvpStroke(obj) {
  try { return (obj.strokeOverprint === true); } catch (e) { return false; }
}
function pfCharOvpFill(ca) {
  try { return (ca.overprintFill === true); } catch (e) { return false; }
}
function pfCharOvpStroke(ca) {
  try { return (ca.overprintStroke === true); } catch (e) { return false; }
}
// v8.3: 叠印样本的色值说明——复用 pfInkSum 的 desc(CMYK 四色 / K 灰 / RGB / 专色),
//   拿不到就退化成 typename(如 PatternColor),再不行给 "(无)"。
function pfOvpDesc(c) {
  if (!c) return "(无)";
  try { var o = pfInkSum(c); if (o && o.desc) return o.desc; } catch (e) {}
  try { if (c.typename) return String(c.typename); } catch (e2) {}
  return "(无)";
}

// v7.8: 采样池——同一个"值"只占 1 条,条数上限 cap;同值再出现时只累加它的 n。
//   为什么:前端拿到 5 条原始样本后会把重复的合并成一行并加 " ×n",
//   若池里 5 条里有重复,合并后就不足 5 行了(雪糕:v7.7 上线后 "只列出了 4 个,我想显示 5 个")。
//   改成"按不同值收"后,5 条 = 5 个不同色值 = 5 行;且 n 是**文档全量真值**,
//   不受采样池大小限制(原来 ×n 只统计池内条数,同色 >5 个就会少报)。
//   key 由调用方给(色值 + 填充/描边 + 名称 + 来源),与前端合并用的分组键保持一一对应。
//   注意: 池满后再出现的**新**值直接丢弃(不显示也不计数)——它由块标题的总数与前端截断提示兜住。
function pfSampleAdd(list, rec, key, cap) {
  for (var i = 0; i < list.length; i++) {
    if (list[i]._k === key) { list[i].n++; return; }
  }
  if (list.length < cap) { rec._k = key; rec.n = 1; list.push(rec); }
}

// v7.9: 采样池"只留最值前 cap 个"—— dir<0 留最大(油墨总量,从高到低),dir>0 留最小(图片 ppi,从低到高)。
//   与 pfSampleAdd 一样按 key 去重(n 累加全量次数),但池满后比的是 rec[field]:
//   不如池内最差的那条就直接丢弃,更优则挤掉最差的、按序插入。
//   列表**始终保持有序**,所以前端按数组顺序渲染即可,不必再排。
//   为什么要这个: 原来"前 5 条"是"树遍历里最先遇到的 5 个"(= 文档顺序,与严重程度无关);
//   改成 top-K 后,列出的才是真正最严重的 5 个,而且有顺序。
//   ⚠ 每类各自取 top-5(文字/图形是两个独立的 stat),前端会把两者合并后再全局排一次。
function pfSampleAddTop(list, rec, key, cap, field, dir) {
  var i, j;
  for (i = 0; i < list.length; i++) {
    if (list[i]._k === key) { list[i].n++; return; }
  }
  if (list.length >= cap) {
    var last = list[list.length - 1];
    if (dir < 0 ? rec[field] <= last[field] : rec[field] >= last[field]) return;
    list.pop();
  }
  rec._k = key; rec.n = 1;
  for (j = 0; j < list.length; j++) {
    if (dir < 0 ? rec[field] > list[j][field] : rec[field] < list[j][field]) break;
  }
  list.splice(j, 0, rec);
}

// 统一返回出口: Base64 编码(仅含字母数字 +/ =,任何传输层都无法破坏)
function pfUtf8Bytes(str) {
  var bytes = [];
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) {
      bytes.push(0xC0 | (c >> 6));
      bytes.push(0x80 | (c & 0x3F));
    } else if (c < 0xD800 || c >= 0xE000) {
      bytes.push(0xE0 | (c >> 12));
      bytes.push(0x80 | ((c >> 6) & 0x3F));
      bytes.push(0x80 | (c & 0x3F));
    } else {
      var c2 = str.charCodeAt(++i);
      var cp = 0x10000 + ((c - 0xD800) << 10) + (c2 - 0xDC00);
      bytes.push(0xF0 | (cp >> 18));
      bytes.push(0x80 | ((cp >> 12) & 0x3F));
      bytes.push(0x80 | ((cp >> 6) & 0x3F));
      bytes.push(0x80 | (cp & 0x3F));
    }
  }
  return bytes;
}

function pfBase64(str) {
  var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var bytes = pfUtf8Bytes(str);
  var out = "";
  var i = 0;
  while (i < bytes.length) {
    var b1 = bytes[i++];
    var b2 = (i < bytes.length) ? bytes[i++] : -1;
    var b3 = (i < bytes.length) ? bytes[i++] : -1;
    var has2 = (b2 !== -1), has3 = (b3 !== -1);
    var n = (b1 << 16) | ((has2 ? b2 : 0) << 8) | (has3 ? b3 : 0);
    out += chars.charAt((n >> 18) & 63);
    out += chars.charAt((n >> 12) & 63);
    out += has2 ? chars.charAt((n >> 6) & 63) : "=";
    out += has3 ? chars.charAt(n & 63) : "=";
  }
  return out;
}

function pfReturn(res) {
  try { res.build = PF_BUILD; } catch (e) {}
  return pfBase64(pfStringify(res));
}

// ============================================================
// 系统字体表缓存(全局,跨多次检查复用)
// app.textFonts 可能有上千个字体,逐个读 name 要跨 COM 桥,耗时可达秒级;
// 缓存后同一 AI 会话内的后续检查直接复用。
// v5.8 修复: 旧实现只在脚本加载时建一次表,且 jsxReady 优化后脚本不再重载,
// 用户中途安装/激活字体(如字魂)后缓存永远不更新,一直误报"缺失字体"。
// 现改为函数化,每次 runPreflight 先比对 textFonts.length(单次跨桥,开销极小),
// 数量变化才重建全表。
// ============================================================
var __pfSysFonts = {};
var __pfSysFontCount = -1;
var __pfSysFontsReady = false;

function pfEnsureFontTable() {
  var n = -1;
  try { n = app.textFonts.length; } catch (eFcnt) { return; }
  if (__pfSysFontCount === n) return; // 数量未变,复用缓存
  __pfSysFontCount = n;
  // 读取失败(length 拿不到)时标记不可用: 空表会把所有字体误报成"缺失",
  // 宁可本次跳过缺失字体检测,也不给出错误结论(v3.3)
  __pfSysFontsReady = (n > 0);
  __pfSysFonts = {};
  try {
    for (var fi = 0; fi < n; fi++) {
      try {
        var sfn = app.textFonts[fi].name;
        if (sfn) {
          // v5.12: 同步记录 family/style(重建时才读,均摊成本;缺失字体占位条目
          // 这两项通常为空,是与真实安装字体区分的关键特征)
          var sfMeta = { f: "", s: "", ph: false };
          try { sfMeta.f = String(app.textFonts[fi].family || ""); } catch (ef1) {}
          try { sfMeta.s = String(app.textFonts[fi].style || ""); } catch (ef2) {}
          // v5.13: 占位条目标记——AI 为文档缺失字体临时挂的条目没有 style,
          // 且 family 为空或直接等于字体名;真实安装的字体 style 至少是 Regular
          sfMeta.ph = (sfMeta.s === "" && (sfMeta.f === "" || sfMeta.f === sfn));
          __pfSysFonts[sfn] = sfMeta;
        }
      } catch (efs) {}
    }
  } catch (efc) {}
  // 构建后校验: 表仍为空(逐条读取全失败/中途异常)则视为不可用,避免半表全量误报(v3.4)
  if (__pfSysFontsReady) {
    __pfSysFontsReady = false;
    for (var fk in __pfSysFonts) { __pfSysFontsReady = true; break; }
  }
}

pfEnsureFontTable(); // 脚本加载时建首表

// v5.13: 缺失判定统一出口——不在表里,或表里只有占位条目(AI 为文档缺失字体
// 临时挂的假条目,见 pfEnsureFontTable 内 ph 标记),都算缺失
function pfIsFontMissing(n) {
  var meta = __pfSysFonts[n];
  if (!meta) return true;
  return !!meta.ph;
}

// v5.6: 文档指纹(名称+路径),供前端在面板获得焦点时判断用户是否切换了文档,
// 切换则自动重新检查(轻量探测,只读 name/path 两个属性)
function pfDocKey() {
  var res = { ok: false };
  try {
    if (app.documents.length === 0) { res.key = "(无文档)"; res.ok = true; return pfReturn(res); }
    var doc = app.activeDocument;
    var p = "";
    try { p = doc.path.fsName; } catch (e) { p = "(未保存)"; }
    res.key = doc.name + "|" + p;
    res.ok = true;
  } catch (err) { res.error = String(err); }
  return pfReturn(res);
}

// ============================================================
// 主检查入口(单遍扫描)
// ============================================================
function runPreflight() {
  var res = { ok: false };
  try {
    pfEnsureFontTable(); // v5.8: 每次检查前同步字体表,中途激活/安装的字体不再漏识别
    if (app.documents.length === 0) {
      res.error = "当前没有打开的文档，请先打开需要检查的 AI 文件。";
      return pfReturn(res);
    }
    var doc = app.activeDocument;
    res.ok = true;
    res.docName = doc.name;
    try { res.docPath = doc.path.fsName; } catch (e0) { res.docPath = "(文档尚未保存)"; }

    // ---------- 1. 画板尺寸 ----------
    var boards = [];
    var abRects = []; // 各画板 rect(v3.4: 供出血逐画板测量)
    var abBleed = []; // 各画板四向最大超出(pt) + 是否有内容
    var activeIdx = 0;
    try { activeIdx = doc.artboards.getActiveArtboardIndex(); } catch (e1) {}
    for (var i = 0; i < doc.artboards.length; i++) {
      var abObj = doc.artboards[i];
      var r = abObj.artboardRect; // [left, top, right, bottom] pt
      abRects.push(r);
      abBleed.push({ top: 0, bottom: 0, left: 0, right: 0, hasContent: false });
      var wMm = (r[2] - r[0]) * PT2MM;
      var hMm = (r[1] - r[3]) * PT2MM;
      boards.push({ name: abObj.name, w: pfRound(wMm), h: pfRound(hMm) });
    }
    res.artboards = boards;
    res.activeArtboard = activeIdx + 1;

    // ---------- 1b. 实际出血(实测) ----------
    // 注: 文档设置出血(documentBleedOffset)前端已不再展示,且 Adobe 脚本接口
    //     对已打开文档读取不可靠(官方确认的已知限制),v3.5 起不再读取,
    //     统一以"实际出血"(内容超出画板的实测值)为准。旧实现见 v3.3/v3.4 备份。
    var bleed = { supported: false, artboards: [] };

    // (B) 实际出血: 测量内容超出各画板边缘的最大距离(每画板独立,v3.4)
    //     v3.7 起测量在"图层→组→对象"树遍历中进行,不再依赖文档级扁平集合
    function measureItem(gb) {
      if (!gb || gb.length < 4) return;
      for (var bi = 0; bi < abRects.length; bi++) {
        var arB = abRects[bi], stB = abBleed[bi];
        if (gb[2] < arB[0] || gb[0] > arB[2] || gb[1] < arB[3] || gb[3] > arB[1]) continue; // 不重叠
        stB.hasContent = true;
        var oTop    = gb[1] - arB[1];
        var oBottom = arB[3] - gb[3];
        var oLeft   = arB[0] - gb[0];
        var oRight  = gb[2] - arB[2];
        if (oTop > stB.top) stB.top = oTop;
        if (oBottom > stB.bottom) stB.bottom = oBottom;
        if (oLeft > stB.left) stB.left = oLeft;
        if (oRight > stB.right) stB.right = oRight;
      }
    }

    // 出血测量(v3.7): 可见性由树遍历上下文保证——隐藏图层/隐藏组的子树根本
    // 不会到达这里,对象自身 hidden 已在 visitItem 排除,无需再沿 parent 链
    // 向上检查;bounds 先行做重叠预测试(纯算术),任一重叠才读 guides。
    function bleedOf(it, checkGuides) {
      var gb = null;
      try { gb = it.geometricBounds; } catch (ebg) { return; }
      if (!gb || gb.length < 4) return;
      var anyOverlap = false;
      for (var bq = 0; bq < abRects.length; bq++) {
        var aq = abRects[bq];
        if (!(gb[2] < aq[0] || gb[0] > aq[2] || gb[1] < aq[3] || gb[3] > aq[1])) { anyOverlap = true; break; }
      }
      if (!anyOverlap) return;
      if (checkGuides) { try { if (it.guides === true) return; } catch (eig) {} }
      measureItem(gb);
    }

    // ---------- 2. 色彩模式 ----------
    res.colorMode = (doc.documentColorSpace === DocumentColorSpace.CMYK) ? "CMYK" : "RGB";

    // ---------- 2b. 隐藏对象检查 ----------
    var hidden = { layerCount: 0, itemCount: 0, layerNames: [], truncated: false };
    // v8.1: 主遍历是否见过"隐藏节点"(隐藏图层/隐藏组/隐藏对象)。
    //   没见过 ⇒ 文档里不可能有隐藏文字 ⇒ 跳过下面那次文档级 textFrames 全量扫描。
    //   ⚠ 只在"确认没有隐藏内容"时为 false;任何读取异常都保守置 true(宁可多扫,不可漏报)。
    var sawHidden = false;

    function checkLayerVisible(layer) {
      try {
        if (layer.visible === false) {
          hidden.layerCount++;
          if (hidden.layerNames.length < 5) hidden.layerNames.push(layer.name || "(未命名图层)"); // v5.19: 10→6; v6.5: →5(列表统一"仅列前 5")
        }
      } catch (ehl) {}
      try {
        var subL = layer.layers;
        for (var si = 0; si < subL.length; si++) checkLayerVisible(subL[si]);
      } catch (ehl2) {}
    }
    try {
      var allLayers = doc.layers;
      for (var liH = 0; liH < allLayers.length; liH++) checkLayerVisible(allLayers[liH]);
    } catch (ehl3) {}

    // 隐藏"对象"统计: v3.7 起随树遍历顺带统计(每类独立配额 underQuota),
    // 不再用文档级扁平集合;隐藏图层/隐藏组的子树整棵跳过,不再逐个读取。
    res.hidden = hidden;

    // ============================================================
    // 3~5. 树遍历引擎(v3.7): 图层→组→对象 一次递归走完
    // 取代旧版 8 个文档级扁平集合分别扫描的模式:
    //   ① 隐藏图层/隐藏组的整棵子树直接跳过,内部对象一个属性都不读
    //     (含大量隐藏图层/备用方案/历史版本的客户文件提速明显);
    //   ② 可见性沿树向下传递,不再逐对象沿 parent 链向上爬;
    //   ③ 每类对象独立扫描配额(underQuota),大文档统计不再偏科。
    // 口径修正(与旧版的差异):
    //   · 隐藏内容不计入油墨/字体/分辨率统计(不输出的内容不参与印刷);
    //   · 复合路径按 1 个对象统计油墨(取首组件色;旧版每个组件各计一次);
    //   · 隐藏图层上的文本框不计入文本总数与缺失字体检测。
    // 注: Layer.pageItems / GroupItem.pageItems 均只含直接子项(不穿透组),
    //     递归进组即可覆盖全部对象,不会重复访问;复合路径按整体处理,
    //     不下钻其组件 pathItems(组件会重复计色)。
    // ============================================================

    // ---------- 字体 + 油墨 数据结构 ----------
    var fonts = { totalText: 0, outlined: false, names: [], truncated: false, missingFonts: [] };
    // v5.15: 极小字号(<6pt)统计,样本带文字内容
    // v6.8: badCount = 其中 <5pt 的重度计数,嵌套在 count 之内
    var tiny = { count: 0, badCount: 0, samples: [] };
    var seen = {};

    // 油墨总量规则: total < 220 无问题; 220 ~ 300 偏重(黄); > 300 超标(红)
    var INK_OK = 220, INK_WARN = 300;
    // v6.2: 样本一律结构化,由前端拼装(便于按"问题类型"分组、加 [文字]/[图形] 标签、合并重复描边)
    //   badSamples/warnSamples: [{name, where, desc, total}]
    //   thinSamples: [{mm, name}]   light.samples: [{src, where, desc, name}]
    var black = {
      text: { ok: 0, warn: 0, bad: 0, rgb: 0, spot: 0, mixed: 0, warnSamples: [], badSamples: [] },
      path: { ok: 0, warn: 0, bad: 0, rgb: 0, spot: 0, warnSamples: [], badSamples: [], truncated: false,
              thin: 0, thinSamples: [] },   // 描边过细(仅图形)
      light: { count: 0, samples: [] },     // 色值极浅(文字+图形)
      // v8.3: 叠印——文字(字符级) + 图形(pageItem 级) 共用一个池,count 为全量真值
      overprint: { count: 0, samples: [] }
    };

    // 按阈值归类,并记录样本(v5.6/B2: 文字/路径各自独立)
    // v7.8: 样本改为"按不同色值收"—— 同值只占 1 条、n 累加全量次数(见 pfSampleAdd)
    // v7.9: 改为 top-5 —— 只留**油墨总量最高的 5 条**,并按总量从高到低排好
    // name: 文字片段或对象名(带引号,可为空); where: "填充"/"描边"
    function inkBucket(stat, cls, name, where) {
      if (cls.total >= 0) {
        var rec = { name: name || "", where: where || "填充", desc: cls.desc, total: cls.total };
        var scKey = cls.desc + "|" + rec.where + "|" + rec.name;
        if (cls.total > INK_WARN) {
          stat.bad++;
          pfSampleAddTop(stat.badSamples, rec, scKey, SAMPLE_CAP, "total", -1);
        } else if (cls.total >= INK_OK) {
          stat.warn++;
          pfSampleAddTop(stat.warnSamples, rec, scKey, SAMPLE_CAP, "total", -1);
        } else {
          stat.ok++;
        }
      } else if (cls.type === "rgb") {
        stat.rgb++;
      } else if (cls.type === "spot") {
        stat.spot++;
      } else if (cls.type === "mixed") {
        stat.mixed++;
      }
    }

    // v8.3: 叠印采样——文字/图形共用一个池,按"来源+填充/描边+色值+名称"去重(同值 ×n)。
    //   与 light 池同款:count 是文档全量真值,SAMPLE_CAP 只截采样池条数。
    function pfOvpAdd(src, where, desc, name) {
      black.overprint.count++;
      pfSampleAdd(black.overprint.samples,
        { src: src, where: where, desc: desc, name: name },
        src + "|" + where + "|" + desc + "|" + name, SAMPLE_CAP);
    }

    function scanPathInk(pi) {
      var bp = black.path;
      var nm = pfObjName(pi);
      var fc = null, sc = null;
      try { fc = pfInkSum(pi.fillColor); } catch (e4) {}
      try { if (pi.stroked) sc = pfInkSum(pi.strokeColor); } catch (e5) {}
      if (fc) inkBucket(bp, fc, nm, "填充");
      if (sc) inkBucket(bp, sc, nm, "描边");
      // v8.3: 叠印检查(图形侧,pageItem 级)——真机 28.0.0 上 PathItem 的这两个属性名尚未验证,
      //   读不到 / 抛异常由 pfOvp* 兜成 false(宁可不报,绝不误报);色值只在命中时才读,摊薄成本。
      try { if (pfOvpFill(pi))   pfOvpAdd("path", "填充", pfOvpDesc(pi.fillColor), nm); } catch (e8) {}
      try { if (pfOvpStroke(pi)) pfOvpAdd("path", "描边", pfOvpDesc(pi.strokeColor), nm); } catch (e9) {}
      // v6.2: 描边过细——已描边且实测宽 <0.1mm(0.005mm 容差,防恰好 0.1mm 误报)
      // v7.8: 同一"实测宽(2 位小数)"只占 1 条,n 累加全量次数(前端仍按 mm 合并显示 ×n)
      try {
        if (pi.stroked) {
          var swMm = pi.strokeWidth * PT2MM;
          if (swMm >= 0 && swMm < THIN_STROKE_MM - 0.005) {
            bp.thin++;
            var swR = Math.round(swMm * 100) / 100;
            pfSampleAdd(bp.thinSamples, { mm: swR, name: nm }, String(swR), SAMPLE_CAP);
          }
        }
      } catch (e6) {}
      // v6.2: 色值极浅——填充/描边任一为 CMYK 且某分量四舍五入后 0<值<5
      try {
        var lf = pfLightChannel(pi.fillColor);
        if (lf) {
          black.light.count++;
          pfSampleAdd(black.light.samples,
            { src: "path", where: "填充", desc: lf, name: nm }, lf + "|填充|" + nm + "|path", SAMPLE_CAP);
        }
        if (pi.stroked) {
          var ls = pfLightChannel(pi.strokeColor);
          if (ls) {
            black.light.count++;
            pfSampleAdd(black.light.samples,
              { src: "path", where: "描边", desc: ls, name: nm }, ls + "|描边|" + nm + "|path", SAMPLE_CAP);
          }
        }
      } catch (e7) {}
    }

    // ---------- 图片嵌入 + 分辨率 数据结构 ----------
    // v5.7: 计数改为树遍历统计(只含可见图),与下面的清单、分辨率口径一致。
    // 旧版取文档级 pls.length / ris.length(含隐藏图),会出现"链接图片 3 张"
    // 但清单只列 1 张的数字对不上的情况。
    // v5.9: 文档级 placedItems 变量自 v5.7 起已无任何引用(死代码),删除,
    // 省掉每次检查一次跨桥调用;文档级集合只保留 rasterItems,
    // 仅用于 XMP 文件名解析(ris)的必要判断。
    var ris = doc.rasterItems;
    // v8.1: linkedAll/linkedHidden 移出本对象 —— 改由 pfLinkScope() 在点"嵌入"时按需统计,
    //   不再每轮检查都扫一遍文档级 placedItems(见文件末尾 pfLinkScope)
    var imgs = { linked: [], linkedCount: 0, embeddedCount: 0, missingCount: 0, truncated: false };

    // v4.8: Symbol 内部扫描统计(符号内可能含未转曲文字/低清图/油墨超标/RGB,
    // 旧版直接跳过导致漏检;下钻定义源后其内部对象进入统一树遍历)
    var symbols = { count: 0, scanned: 0 };

    // 有效 PPI = 72 / 矩阵基向量模长(与旋转/斜切角度无关)
    var RESO_MIN = 300;
    var reso = { total: 0, lowCount: 0, okCount: 0, samples: [], truncated: false };

    function ppiOf(item) {
      try {
        var m = item.matrix;
        // 缩放因子取矩阵基向量模长: x轴→(A,B), y轴→(C,D)。
        // 旧实现只看 A/D 轴向分量,旋转45°时真实 212ppi 会被高估成约 300ppi 判为达标(漏检);
        // 模长与旋转/斜切角度无关,任意角度下结果稳定(v3.3 修正)
        var sx = Math.sqrt(m.mValueA * m.mValueA + m.mValueB * m.mValueB);
        var sy = Math.sqrt(m.mValueC * m.mValueC + m.mValueD * m.mValueD);
        if (sx < 0.0001 || sy < 0.0001) return -1;
        // v8.1: 返回**原值**(不再 Math.round)。旧版在这里提前取整,299.6ppi 被当成 300
        //   ⇒ 恰好卡在阈值上时判为"达标"而漏报;改由前端显示时再取整(与油墨总量同一口径)。
        return Math.min(72 / sx, 72 / sy); // 取较小值,保守
      } catch (e) { return -1; }
    }

    function resoCheck(item, label) {
      var ppi = ppiOf(item);
      if (ppi < 0) return;
      reso.total++;
      if (ppi < RESO_MIN) {
        reso.lowCount++;
        // v5.19: 15→8; v6.5: →5(列表统一"仅列前 5")
        // v7.9: 只留**分辨率最低的 5 张**,并按 ppi 从低到高排好(原来取的是文档里最先遇到的 5 张)
        //   这里用递增序号做 key ⇒ 不去重(每张图各占一条;同图重复置入也各自可见)
        pfSampleAddTop(reso.samples, { name: label, ppi: ppi }, "r" + reso.total, 5, "ppi", 1);
      } else {
        reso.okCount++;
      }
    }

    // 通用: 取图片名称(name → file.name → 兜底)
    function imgName(item, fallback) {
      try { if (item.name && item.name !== "") return item.name; } catch (e) {}
      try { var f = item.file; if (f && f.name && f.name !== "") return f.name; } catch (e) {}
      return fallback;
    }

    // 从 XMP 元数据提取"嵌入"类型图片的文件名(嵌入位图 name/file 属性为空,只能从 XMP 取)
    // XMP manifest 中每个条目有 stMfs:linkForm(EmbedByReference=链接 / EmbedByValue=嵌入) 和 stRef:filePath
    function xmpEmbeddedNames() {
      var names = [];
      try {
        var xs = doc.XMPString;
        if (!xs) return names;
        var forms = [], paths = [], m;
        var reF = /<stMfs:linkForm>([^<]*)<\/stMfs:linkForm>/g;
        var reP = /<stRef:filePath>([^<]*)<\/stRef:filePath>/g;
        while ((m = reF.exec(xs)) !== null) forms.push(m[1]);
        while ((m = reP.exec(xs)) !== null) paths.push(m[1]);
        for (var i = 0; i < forms.length && i < paths.length; i++) {
          if (forms[i] === "EmbedByValue") {
            var p = paths[i];
            var nm = p;
            var ix = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
            if (ix >= 0) nm = p.substring(ix + 1);
            names.push(nm);
          }
        }
      } catch (ex) {}
      return names;
    }

    // 无位图时跳过 XMP 解析(XMP 文本可能很大,解析开销高)
    var xmpEmbNames = (ris.length > 0) ? xmpEmbeddedNames() : [];
    var xmpSeq = 0;      // 顺序兜底指针
    var rasterIdx = 0;   // 已处理的嵌入位图计数
    var placedIdx = 0;   // 已处理的链接图计数
    function embName(item, idx, fallback) {
      var n = imgName(item, "");
      if (n !== "") return n;
      // XMP 嵌入条目数与文档嵌入位图数一致时,按索引精确对应;否则按顺序兜底
      if (xmpEmbNames.length === ris.length && idx < xmpEmbNames.length) return xmpEmbNames[idx];
      if (xmpSeq < xmpEmbNames.length) return xmpEmbNames[xmpSeq++];
      return fallback;
    }

    // ---------- 每类对象独立扫描配额(v3.6/v3.7) ----------
    // 防大文件卡死;每类各自最多 MAX_SCAN 个,统计不再因扫描顺序偏科。
    // 注: 超配额由各调用方挂对应类别自己的 truncated(不再统一挂 hidden,
    //      v4.8 修复: 原先任何类超限都会误置 hidden.truncated,导致隐藏对象
    //      卡错误显示"仅扫描前 3000 个")。
    var scanTicks = {};
    function underQuota(cat) {
      var n = scanTicks[cat] || 0;
      if (n >= MAX_SCAN) return false;
      scanTicks[cat] = n + 1;
      return true;
    }

    // ---------- 树遍历 ----------
    // 单个对象: 按 typename 分派(可见性已由 walkLayer 的图层过滤保证,
    // 无需再传 vis 标志 —— v4.8 清理死参数)
    function visitItem(it, depth) {
      if (depth > 64) return; // 防异常深嵌套导致栈溢出(超过深度放弃下钻)
      var tn = "";
      try { tn = it.typename; } catch (eT) { return; }

      // 组: 隐藏组整棵子树跳过;可见组继续下钻
      if (tn === "GroupItem") {
        var gHidden = false;
        try { gHidden = (it.hidden === true); } catch (eGv) {}
        if (gHidden) {
          sawHidden = true;   // v8.1: 见到隐藏组 ⇒ 内部可能有隐藏文字
          if (underQuota("group")) hidden.itemCount++;
          else hidden.truncated = true; // v4.8: 隐藏组超配额只挂 hidden 自己的截断
          return;
        }
        bleedOf(it, false); // v5.25: 出血先于配额(配额只截断统计,不截断出血测量)
        try {
          var kids = it.pageItems;
          for (var k = 0; k < kids.length; k++) visitItem(kids[k], depth + 1);
        } catch (eGk) { sawHidden = true; }   // v8.1: 组内读不到 ⇒ 不敢断言"无隐藏"
        return;
      }

      // 对象自身隐藏(Ctrl+3)
      var selfHidden = false;
      try { selfHidden = (it.hidden === true); } catch (eH) {}

      var cat = "";
      if (tn === "TextFrame") cat = "text";
      else if (tn === "PathItem") cat = "path";
      else if (tn === "CompoundPathItem") cat = "compound";
      else if (tn === "MeshItem") cat = "mesh";
      else if (tn === "SymbolItem") cat = "symbol";
      else if (tn === "RasterItem") cat = "raster";
      else if (tn === "PlacedItem") cat = "placed";
      if (cat === "") return;

      // 隐藏对象统计(每类独立配额);隐藏内容不输出 → 跳过一切印刷相关检查
      if (selfHidden) {
        sawHidden = true;   // v8.1: 见到隐藏对象(可能是隐藏文本框) ⇒ 需保留隐藏文字扫描
        if (underQuota(cat)) hidden.itemCount++;
        else hidden.truncated = true; // v5.6/B1: 超配额也必须挂截断标记,否则隐藏数被低估且界面无提示
        return;
      }

      if (tn === "TextFrame") {
        bleedOf(it, false); // v5.25: 出血先于配额(配额只截断统计,不截断出血测量)
        // v4.8: 配额检查前置,totalText 只统计实际扫描数(原在配额前++,超限仍虚增)
        if (!underQuota("text")) { fonts.truncated = true; return; }
        fonts.totalText++;
        var fn = "";
        try { fn = it.textRange.characterAttributes.textFont.name; }
        catch (e3) { fn = "(混合字体)"; }
        if (fn && !seen[fn]) { seen[fn] = true; fonts.names.push(fn); }
        // v5.15: 极小字号检测(混合字号帧读 size 会抛异常,跳过不误报)
        try {
          var fsz = it.textRange.characterAttributes.size;
          if (typeof fsz === "number" && isFinite(fsz) && fsz > 0 && fsz < TINY_PT) {
            tiny.count++;
            if (fsz < TINY_BAD_PT) tiny.badCount++; // v6.8: <5pt 额外计入重度(嵌套)
            if (tiny.samples.length < 5) tiny.samples.push({ t: pfSnippet(it), pt: pfRound(fsz) });
          }
        } catch (eSz) {}
        var cls = pfTextInk(it);
        if (cls) inkBucket(black.text, cls, pfSnippet(it), "填充");
        // v6.2: 色值极浅(文字填充色,混合色读取抛异常则跳过)
        // v7.8: 按不同色值收(与图形侧同一个池),n 累加全量次数
        try {
          var ltf = pfLightChannel(it.textRange.characterAttributes.fillColor);
          if (ltf) {
            black.light.count++;
            var ltfName = pfSnippet(it);
            pfSampleAdd(black.light.samples,
              { src: "text", where: "填充", desc: ltf, name: ltfName },
              ltf + "|填充|" + ltfName + "|text", SAMPLE_CAP);
          }
        } catch (eLtf) {}
        // v8.3: 叠印检查(文字侧)——**只能走字符级**,真机 28.0.0 上 TextFrame 没有
        //   pageItem 级 fillOverprint/strokeOverprint(探针 v1 实测为"缺失")。
        //   两个布尔读很便宜(characterAttributes 本来就已读过),命中才取色值 + 片段。
        try {
          var oca = it.textRange.characterAttributes;
          var ovf = pfCharOvpFill(oca), ovs = pfCharOvpStroke(oca);
          if (ovf || ovs) {
            var ovn = pfSnippet(it);
            if (ovf) pfOvpAdd("text", "填充", pfOvpDesc(oca.fillColor), ovn);
            if (ovs) pfOvpAdd("text", "描边", pfOvpDesc(oca.strokeColor), ovn);
          }
        } catch (eOvp) {}
        return;
      }
      if (tn === "PathItem") {
        bleedOf(it, true);  // v5.25: 出血先于配额(配额只截断统计,不截断出血测量)
        if (!underQuota("path")) { black.path.truncated = true; return; }
        scanPathInk(it);
        return;
      }
      if (tn === "CompoundPathItem") {
        bleedOf(it, true);  // v5.25: 出血先于配额(配额只截断统计,不截断出血测量)
        if (!underQuota("compound")) { black.path.truncated = true; return; }
        try { scanPathInk(it.pathItems[0]); } catch (eC) {}
        return;
      }
      if (tn === "MeshItem") {
        bleedOf(it, false); // v5.25: 出血先于配额(配额只截断统计,不截断出血测量)
        if (!underQuota("mesh")) return;
        return;
      }
      if (tn === "SymbolItem") {
        bleedOf(it, false); // v5.25: 出血先于配额(配额只截断统计,不截断出血测量)
        if (!underQuota("symbol")) return;
        // v4.8: 下钻 Symbol 定义源,扫描内部对象(缺失字体/分辨率/油墨等)
        // 多个实例引用同一符号时会重复扫描(与"实际输出内容"口径一致);
        // 定义源不可访问时静默跳过,仅统计数量
        symbols.count++;
        try {
          var symDef = null;
          try { symDef = it.symbol; } catch (eSD) {}
          var symSrc = null;
          if (symDef) {
            try { symSrc = symDef.item; } catch (eSI) {}
            if (!symSrc) { try { symSrc = symDef; } catch (eS2) {} }
          }
          if (symSrc && symSrc.pageItems) {
            var symKids = symSrc.pageItems;
            for (var sk = 0; sk < symKids.length; sk++) visitItem(symKids[sk], depth + 1);
            symbols.scanned++;
          }
        } catch (eSym) {}
        return;
      }
      if (tn === "RasterItem") {
        bleedOf(it, false); // v5.25: 出血先于配额(配额只截断统计,不截断出血测量)
        if (!underQuota("raster")) { reso.truncated = true; imgs.truncated = true; return; }
        imgs.embeddedCount++; // v5.7: 只统计可见的嵌入位图
        resoCheck(it, embName(it, rasterIdx, "(嵌入位图" + (rasterIdx + 1) + ")"));
        rasterIdx++;
        return;
      }
      // PlacedItem
      bleedOf(it, false); // v5.25: 出血先于配额(配额只截断统计,不截断出血测量)
      if (!underQuota("placed")) { reso.truncated = true; imgs.truncated = true; return; }
      imgs.linkedCount++; // v5.7: 只统计可见的链接图(隐藏链接图不参与印刷,不计入)
      // v5.15: 源文件存在性——被移动/改名/未随包拷贝的链接 AI 输出时会用
      // 低清预览替代;仅 file.exists 明确为 false 才计缺失,读不到不算
      var lkMissing = false;
      try { lkMissing = (it.file.exists === false); } catch (eEx2) {}
      if (lkMissing) imgs.missingCount++;
      // 文件路径只读一次: 前 5 个用于展示(v6.5: 50→5,列表统一"仅列前 5"),同时取扩展名判断位图/矢量
      var fp = "";
      try { fp = String(it.file.fsName); } catch (e11) {}
      if (imgs.linked.length < 5) {
        imgs.linked.push({ name: it.name || "(链接图)", file: fp || "(无法读取路径)", missing: lkMissing });
      }
      // 矢量链接(PDF/AI/EPS/SVG)没有有效分辨率: identity 矩阵会被算成
      // 72ppi 而误报"低于300ppi",只对位图扩展名检查(v3.6);
      // 扩展名拿不到时保守起见仍检查(与旧版一致)
      var extB = "";
      var dotB = fp.lastIndexOf(".");
      if (dotB >= 0) extB = fp.substring(dotB + 1).toLowerCase();
      var isBmp = (extB === "tif" || extB === "tiff" || extB === "jpg" || extB === "jpeg" ||
                   extB === "png" || extB === "psd" || extB === "bmp" || extB === "gif");
      if (isBmp || extB === "") {
        resoCheck(it, imgName(it, "(链接图" + (placedIdx + 1) + ")"));
      }
      placedIdx++;
    }

    // 图层: 隐藏图层整层子树跳过(0 次对象读取);可见层先下钻子图层再遍历对象
    function walkLayer(ly, depth) {
      if (depth > 64) return;
      try { if (ly.visible === false) { sawHidden = true; return; } } catch (eLv) { sawHidden = true; return; }
      try {
        var subs = ly.layers;
        for (var si = 0; si < subs.length; si++) walkLayer(subs[si], depth + 1);
      } catch (eLs) { sawHidden = true; }   // v8.1: 子图层读不到 ⇒ 不敢断言"无隐藏"
      try {
        var items = ly.pageItems;
        for (var ii = 0; ii < items.length; ii++) visitItem(items[ii], 0);
      } catch (eLi) { sawHidden = true; }   // v8.1: 对象列表读不到 ⇒ 同上
    }
    try {
      var topLayers = doc.layers;
      for (var liW = 0; liW < topLayers.length; liW++) walkLayer(topLayers[liW], 0);
    } catch (eW) { sawHidden = true; }      // v8.1: 顶层图层读不到 ⇒ 同上

    // ---------- v5.21: 隐藏文字统计 ----------
    // 树遍历跳过隐藏子树(提速优化),隐藏文字因此不进 totalText/缺失检测;
    // 这里用 doc.textFrames 文档级全集(含隐藏层/隐藏对象/锁定,符号内文字不在
    // 其中)单独补一遍: 隐藏帧计数,字体名并入涉及字体与缺失检测。
    // 封顶 500 帧(诊断性质,大文档不再往下数,挂 truncated);
    // 可见性判定复用一键转曲的 pfBlockInfo(沿 parent 链找 hidden 节点)。
    var hiddenText = { count: 0, missingCount: 0, truncated: false };
    // v8.1: 前置门控 —— 主遍历只要遇到过一个隐藏节点(隐藏图层/隐藏组/隐藏对象),
    //   才可能存在"隐藏文字";一个都没遇到时隐藏文字必然为 0,于是这次"文档级 textFrames
    //   全量扫描(封顶 500 帧,每帧还都要沿 parent 链判可见性)"可以整段跳过。
    //   ⚠ 只要有任何读取异常都置 sawHidden=true,宁可多扫不多漏(见 walkLayer/visitItem)。
    if (sawHidden) {
      try {
        var dtfsAll = doc.textFrames;
        var capHT = dtfsAll.length > 500 ? 500 : dtfsAll.length;
        for (var ht = 0; ht < capHT; ht++) {
          var tfH = dtfsAll[ht];
          var visH = true;
          try {
            var blkH = pfBlockInfo(tfH);
            if (blkH && blkH.reason === "hidden") visH = false;
          } catch (eBkH) {}
          if (visH) continue;
          hiddenText.count++;
          var fnH = "";
          try { fnH = tfH.textRange.characterAttributes.textFont.name; } catch (eFnH) { fnH = ""; }
          if (fnH && fnH !== "(混合字体)") {
            if (!seen[fnH]) { seen[fnH] = true; fonts.names.push(fnH); }
            if (pfIsFontMissing(fnH)) hiddenText.missingCount++;
          }
        }
        if (dtfsAll.length > capHT) hiddenText.truncated = true;
      } catch (eHT) {}
    }

    // ---------- 扫描后处理: 缺失字体 / 结果挂载 ----------
    // 检测缺失字体: 与系统字体表对比(表已缓存于全局 __pfSysFonts,跨检查复用)
    try {
      var missMap = {};
      if (typeof __pfSysFontsReady !== "undefined" && __pfSysFontsReady) {
        for (var mfi = 0; mfi < fonts.names.length; mfi++) {
          var n = fonts.names[mfi];
          if (n && n !== "(混合字体)" && pfIsFontMissing(n)) missMap[n] = true;
        }
      }
      for (var mk in missMap) fonts.missingFonts.push(mk);
      fonts.missingFonts.sort(); // v5.6/B4: 固定字母序,同一文档每次检查列表顺序一致
    } catch (eMiss) {}
    // v5.16: v5.10~v5.12 的诊断量(res.fontDiag/文档级扫描/命中明细)已随根因
    // 确诊(占位条目)整体移除,检查耗时回到 v5.9 水平;占位条目过滤(pfIsFontMissing)保留。
    fonts.outlined = (fonts.totalText === 0);
    res.fonts = fonts;
    res.black = black;
    // v8.1: 链接图范围统计已移出主流程 —— 旧版这里每轮都跑一次 pfCountAllLinks(doc)
    //       (全文档 placedItems 遍历 + 逐项沿 parent 链判隐藏),但它只服务"一键嵌入"的
    //       确认框,用户极少点。现改为点"嵌入"时按需调用 pfLinkScope()(见文件末尾)。
    res.images = imgs;
    res.resolution = reso;
    res.symbols = symbols;
    res.tiny = tiny; // v5.15: 极小字号统计
    res.hiddenText = hiddenText; // v5.21: 隐藏文字统计

    // 实际出血汇总: 每个画板独立判定;v4.2 起空画板也判定(按 0 出血计入"不足")
    // v4.5 起四边全判: 每条边的实测出血独立检查,任一边 <3mm 即列入不足清单。
    // 内容未贴到的边出血按 0 计(内容没超出画板边缘就没有出血)——例如画板只有
    // 左上角贴到、右下角留白,右下 0mm 也会报,不再因为"贴到的边达标"而整体放行。
    bleed.supported = true;
    for (var bs = 0; bs < abBleed.length; bs++) {
      var stB = abBleed[bs];
      var shortEdges = [];
      // 收集不足边: 实测出血 < 3mm(含 v4.1 的 0.05mm 容差,防 8.5pt=2.9986mm 误报)
      var pushShort = function (edge, pt) {
        if (pt * PT2MM < BLEED_MIN_MM - 0.05) shortEdges.push({ edge: edge, mm: pfRound(pt * PT2MM) });
      };
      if (stB.hasContent) {
        pushShort("上", stB.top);
        pushShort("下", stB.bottom);
        pushShort("左", stB.left);
        pushShort("右", stB.right);
      } else {
        // v4.2: 空画板四方向出血为 0,全部不足
        shortEdges = [{ edge: "上", mm: 0 }, { edge: "下", mm: 0 }, { edge: "左", mm: 0 }, { edge: "右", mm: 0 }];
      }
      var isInsufficient = shortEdges.length > 0;
      // 最差边(兜底展示用): 不足边中数值最小的一条
      var worstEdge = "";
      var worstMm = Infinity;
      for (var we = 0; we < shortEdges.length; we++) {
        if (shortEdges[we].mm < worstMm) { worstMm = shortEdges[we].mm; worstEdge = shortEdges[we].edge; }
      }
      var minPt = Math.min(stB.top, stB.bottom, stB.left, stB.right); // 四边最小(pt)
      bleed.artboards.push({
        name: boards[bs].name,
        top: pfRound(stB.top * PT2MM), bottom: pfRound(stB.bottom * PT2MM),
        left: pfRound(stB.left * PT2MM), right: pfRound(stB.right * PT2MM),
        minMm: pfRound(minPt * PT2MM),
        hasContent: stB.hasContent,
        worstEdge: worstEdge,
        shortEdges: shortEdges,   // v4.5: 该画板所有 <3mm 的边 [{edge, mm}]
        insufficient: isInsufficient
      });
    }
    res.bleed = bleed;

    return pfReturn(res);
  } catch (err) {
    res.ok = false;
    res.error = "检查过程出错: " + String(err);
    return pfReturn(res);
  }
}

// ============================================================
// 一键操作: 按需解锁/显示图层(含子图层)
// unlockAll=true 时解锁; showAll=true 时显示; 可单独或同时
// ============================================================
function pfUnlockLayer(layer, unlockAll, showAll) {
  if (unlockAll) { try { layer.locked = false; } catch (e) {} }
  if (showAll) { try { layer.visible = true; } catch (e) {} }
  try {
    var sub = layer.layers;
    for (var i = 0; i < sub.length; i++) pfUnlockLayer(sub[i], unlockAll, showAll);
  } catch (e) {}
}

// ============================================================
// 阻挡检测: 沿 parent 链向上(对象 → 组 → 图层 → 父图层)逐级检查
// 修 bug: 旧逻辑只看文字所在图层,漏掉两类真实阻挡——
//   1) 对象自身被 Ctrl+2 锁定(pageItem.locked,与图层锁定无关)
//   2) 文字在被锁定的组(groupItem)里,或对象被 Ctrl+3 隐藏
// 返回 {reason:"hidden"|"locked", node:阻挡节点},便于按勾选状态精确解除
// ============================================================
function pfBlockInfo(item) {
  var p = item, guard = 0;
  while (p && guard++ < 40) {
    var tn = "";
    try { tn = p.typename; } catch (et) { break; }
    if (tn === "Document") break;
    try { if (p.visible === false || p.hidden === true) return { reason: "hidden", node: p }; } catch (e) {}
    try { if (p.locked === true) return { reason: "locked", node: p }; } catch (e) {}
    try { p = p.parent; } catch (ep) { break; }
  }
  return null;
}

// 解除单个阻挡节点(Layer 用 visible,对象用 hidden);成功返回 true
function pfClearBlock(node, reason) {
  try {
    if (reason === "locked") { node.locked = false; return true; }
    if (reason === "hidden") {
      var tn = "";
      try { tn = node.typename; } catch (et) {}
      if (tn === "Layer") node.visible = true;
      else node.hidden = false;
      return true;
    }
  } catch (e) {}
  return false;
}

// ============================================================
// 一键转曲: 只转曲"可见且未锁定"的文字
// showAll/unlockAll 控制转曲前是否先解除隐藏/锁定;
// v3.9: "解锁"同时覆盖图层锁定与对象级锁定(Ctrl+2)、锁定组;
//       "显示"同时覆盖图层隐藏与对象级隐藏(Ctrl+3)。
//       未勾选项对应的阻挡状态原样保留,该文字跳过不转。
// ============================================================
function pfOutlineAll(showAll, unlockAll) {
  var res = { ok: false };
  try {
    if (app.documents.length === 0) { res.error = "当前没有打开的文档。"; return pfReturn(res); }
    var doc = app.activeDocument;
    var sAll = (showAll === true);
    var uAll = (unlockAll === true);

    // 1. 按需解锁/显示全部图层(含子图层)
    if (sAll || uAll) {
      var layers = doc.layers;
      for (var i = 0; i < layers.length; i++) pfUnlockLayer(layers[i], uAll, sAll);
    }

    // 2. 转曲文字(倒序,避免集合变化导致漏转)
    var tfs = doc.textFrames;
    var done = 0, skipped = 0, failed = 0, unlocked = 0, unhidden = 0;
    for (var i = tfs.length - 1; i >= 0; i--) {
      var tf = tfs[i];
      var info = null;
      try { info = pfBlockInfo(tf); } catch (e1) {}
      // 按勾选状态逐层解除阻挡: 对象→组→图层可能叠多层锁定/隐藏,
      // 旧版只解一层,遇到"锁定对象在锁定组内"会漏转(v3.3 修复),改为循环解除
      var guardB = 0;
      while (info && guardB++ < 10) {
        var clearable = (info.reason === "locked" && uAll) || (info.reason === "hidden" && sAll);
        if (!clearable || !pfClearBlock(info.node, info.reason)) break;
        if (info.reason === "locked") unlocked++; else unhidden++;
        try { info = pfBlockInfo(tf); } catch (e2) {}
      }
      if (info) { skipped++; continue; }
      try { tf.createOutline(); done++; } catch (e) { failed++; }
    }

    res.ok = true;
    res.outlined = done;
    res.skipped = skipped;
    res.failed = failed;
    res.unlocked = unlocked;
    res.unhidden = unhidden;
    res.message = "已转曲 " + done + " 个文本框" +
      (unlocked > 0 ? "，解除锁定 " + unlocked + " 处" : "") +
      (unhidden > 0 ? "，取消隐藏 " + unhidden + " 处" : "") +
      (skipped > 0 ? "，跳过 " + skipped + " 个(隐藏/锁定，未勾选对应选项)" : "") +
      (failed > 0 ? "，失败 " + failed + " 个" : "") + "。";
  } catch (err) {
    res.ok = false;
    res.error = "转曲失败: " + String(err);
  }
  return pfReturn(res);
}

// v8.0: 统计"文档全部链接图 + 其中隐藏的" —— 供确认框如实说明嵌入范围。
//   背景: 检查端是树遍历"只含可见图"(v5.7),而 pfEmbedAll 走 doc.placedItems(**含隐藏**),
//   两处范围不同 ⇒ 卡片上的"链接图片 N 张" != 实际会被嵌入的张数。
//   隐藏判定: 对象自身 hidden,或任一祖先组 hidden,或所属图层 visible === false。
function pfCountAllLinks(doc) {
  var all = 0, hid = 0;
  try {
    var pls = doc.placedItems;
    all = pls.length;
    for (var i = 0; i < pls.length; i++) {
      var it = pls[i], isH = false;
      try { if (it.hidden === true) isH = true; } catch (e1) {}
      if (!isH) {
        var p = null;
        try { p = it.parent; } catch (e2) {}
        var guard = 0;
        while (p && guard++ < 64) {
          var tn = "";
          try { tn = p.typename; } catch (e3) {}
          if (tn === "Layer") {
            try { if (p.visible === false) isH = true; } catch (e4) {}
            break;   // 到图层即止(图层之下不再有祖先)
          }
          try { if (p.hidden === true) isH = true; } catch (e5) {}
          try { p = p.parent; } catch (e6) { break; }
        }
      }
      if (isH) hid++;
    }
  } catch (e0) {}
  return { all: all, hidden: hid };
}

// v8.1: 按需入口 —— 供前端"一键嵌入"确认框取"全部链接图 / 其中隐藏数"。
//   旧版在 runPreflight 末尾**无条件**统计一次(每轮检查都全文档遍历 placedItems),
//   但确认框只有点"嵌入"才看得到 ⇒ 绝大多数检查白跑一次。现改为点嵌入时单独调用。
function pfLinkScope() {
  var res = { ok: false };
  try {
    if (app.documents.length === 0) { res.error = "当前没有打开的文档。"; return pfReturn(res); }
    var c = pfCountAllLinks(app.activeDocument);
    res.ok = true;
    res.all = c.all;
    res.hidden = c.hidden;
  } catch (e) { res.error = "统计链接图失败: " + String(e); }
  return pfReturn(res);
}

// ============================================================
// 一键嵌入所有链接图片
// v3.6: PDF/AI/EPS 矢量链接用 embed() 会拆成多个矢量对象(分层),
//       改为按 300dpi 栅格化,拼合为单张位图;位图链接(tif/jpg/png/psd)
//       embed() 本身就是单张位图,保持原方式保真。
// ============================================================
function pfEmbedAll() {
  var res = { ok: false };
  try {
    if (app.documents.length === 0) { res.error = "当前没有打开的文档。"; return pfReturn(res); }
    var doc = app.activeDocument;

    var pls = doc.placedItems;
    var done = 0, failed = 0, flattened = 0;
    var failedNames = []; // v4.6: 失败明细(文件名),便于用户定位问题图
    for (var i = pls.length - 1; i >= 0; i--) {
      var it = pls[i];
      var fp = "";
      try { fp = String(it.file.fsName); } catch (ef) {}
      var name = "";
      try { name = String(it.name); } catch (en2) {}
      if (!name || name === "") name = fp ? fp : "(链接图" + (i + 1) + ")";
      var ext = "";
      var dot = fp.lastIndexOf(".");
      if (dot >= 0) ext = fp.substring(dot + 1).toLowerCase();

      if (ext === "pdf" || ext === "ai" || ext === "eps") {
        // 矢量链接: 栅格化拼合为单张位图(300dpi,印刷标准)
        var okOne = false, wasFlat = false;
        try {
          var ro = new RasterizeOptions();
          ro.resolution = 300;
          ro.colorModel = RasterizationColorModel.DEFAULTCOLORMODEL;
          ro.transparency = true;
          ro.antiAliasingMethod = AntiAliasingMethod.ARTOPTIMIZED;
          ro.convertSpotColors = true;
          ro.convertTextToOutlines = true;
          ro.includeLayers = false;
          ro.padding = 0.0;
          doc.rasterize(it, null, ro);
          okOne = true; wasFlat = true;   // v8.0: 只有真栅格化成功才算"已拼合"
        } catch (er) {
          // v8.0: 栅格化失败回退普通嵌入 —— 对象仍是矢量、并没有被拼合,
          //       所以只计入 done、**不再**计 flattened(旧版会谎报"已拼合为单张位图")
          try { it.embed(); okOne = true; } catch (eb) {}
        }
        if (okOne) { done++; if (wasFlat) flattened++; } else { failed++; failedNames.push(name); }
      } else {
        // 位图链接: embed() 即为单张位图,不损失原始分辨率
        try { it.embed(); done++; } catch (e2) { failed++; failedNames.push(name); }
      }
    }
    res.ok = true;
    res.embedded = done;
    res.failedNames = failedNames;
    res.message = "已嵌入 " + done + " 张链接图" +
      (flattened > 0 ? "(其中 " + flattened + " 张矢量链接已拼合为单张位图)" : "") + "。" +
      (failed > 0 ? " 失败 " + failed + " 张:" + failedNames.join("、") + "。" : "");
  } catch (err) {
    res.ok = false;
    res.error = "嵌入失败: " + String(err);
  }
  return pfReturn(res);
}
