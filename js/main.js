/* 印前检查-雪糕 面板前端逻辑 (CEP) */
(function () {
  "use strict";

  var JS_BUILD = "20260922-1";
  // 必须与 jsx/preflight.jsx 里的 PF_BUILD 保持一致。
  // JSX 每次返回都会带上它的构建号,前端据此判断 ExtendScript 引擎里
  // 加载的是不是当前版本 —— 不一致就强制 $.evalFile 重载(见 execJsx)。
  var JSX_BUILD = "8.3";

  // 全局错误捕获: 把任何未捕获异常显示到面板,便于定位"空白"问题
  window.onerror = function (msg, url, line, col) {
    try {
      var el = document.getElementById("error");
      if (el) {
        el.textContent = "JS运行错误: " + msg + " (行 " + line + ")";
        el.classList.remove("hidden");
      }
    } catch (e) {}
    return false;
  };

  function $(id) { return document.getElementById(id); }

  // Base64 解码 + UTF-8 还原
  function b64ToStr(b64) {
    var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    var bytes = [];
    b64 = String(b64).replace(/[^A-Za-z0-9+/=]/g, "");
    var buf = 0, bits = 0;
    for (var i = 0; i < b64.length; i++) {
      var c = b64.charAt(i);
      if (c === "=") break;
      var idx = chars.indexOf(c);
      if (idx < 0) continue;
      buf = (buf << 6) | idx;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        bytes.push((buf >> bits) & 0xFF);
      }
    }
    var out = "";
    var j = 0;
    while (j < bytes.length) {
      var b = bytes[j++];
      if (b < 0x80) out += String.fromCharCode(b);
      else if (b < 0xE0) out += String.fromCharCode(((b & 0x1F) << 6) | (bytes[j++] & 0x3F));
      else if (b < 0xF0) out += String.fromCharCode(((b & 0x0F) << 12) | ((bytes[j++] & 0x3F) << 6) | (bytes[j++] & 0x3F));
      else {
        var cp = ((b & 0x07) << 18) | ((bytes[j++] & 0x3F) << 12) | ((bytes[j++] & 0x3F) << 6) | (bytes[j++] & 0x3F);
        cp -= 0x10000;
        out += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF));
      }
    }
    return out;
  }

  function inCEP() { return !!window.__adobe_cep__; }

  function evalScript(script, cb) {
    window.__adobe_cep__.evalScript(script, cb);
  }

  // ---------- JSX 调用统一入口 ----------
  // 统一解析返回值: Base64(新) 优先; 兼容 URL 编码与纯 JSON 的旧返回。
  // 解析不出结构化结果时返回 null(不抛异常),由调用方决定如何提示。
  function parseResult(result) {
    try {
      if (!result || result === "undefined" || result === "EvalScript error.") return null;
      if (result.charAt(0) === "%") return JSON.parse(decodeURIComponent(result));
      if (/^[A-Za-z0-9+/=]+$/.test(result) && result.charAt(0) !== "{") return JSON.parse(b64ToStr(result));
      return JSON.parse(result);
    } catch (e) { return null; }
  }

  function jsxFilePath() {
    var extPath = "";
    try { extPath = decodeURI(window.__adobe_cep__.getSystemPath("extension")); } catch (e) {}
    return (extPath + "/jsx/preflight.jsx").replace(/\\/g, "/");
  }

  // v3.1: 已确认引擎内 JSX 版本正确时,跳过 $.evalFile 直接调用函数,
  // 省掉每次检查都重新读取并解析 28KB 脚本的开销。
  // 两种情况会自动退回"带重载"的调用: ① AI 重启后引擎被清空
  // ② 部署了新版 jsx(PF_BUILD 变了)—— 所以改完 JSX 仍无需重启 AI。
  var jsxReady = false;
  function execJsx(call, cb) {
    var withLoad = '$.evalFile("' + jsxFilePath() + '"); ' + call;
    var first = jsxReady ? call : withLoad;
    evalScript(first, function (result) {
      var data = parseResult(result);
      if (data && data.build === JSX_BUILD) { jsxReady = true; cb(data, result); return; }
      if (first === withLoad) { jsxReady = false; cb(data, result); return; } // 已重载仍异常
      evalScript(withLoad, function (result2) {
        var data2 = parseResult(result2);
        jsxReady = !!(data2 && data2.build === JSX_BUILD);
        cb(data2, result2);
      });
    });
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // v5.0: 文件名显示处理
  // ① URL 编码还原: AI 的 item.name 可能是 %E5%B0%81... 编码形态,
  //    先尝试 decodeURIComponent 还原成中文;名字里恰好含非法 % 时保持原样
  function decodeImgName(s) {
    s = String(s || "");
    if (s.indexOf("%") < 0) return s;
    try {
      var d = decodeURIComponent(s);
      // 还原结果不应再含 %xx(防止二次编码/误解码)
      return (d.indexOf("%") < 0) ? d : s;
    } catch (e) { return s; }
  }

  // ② 单行截断: 超过 maxLen 个字符截断加 …(完整名由调用方放 title)
  function truncName(s, maxLen) {
    s = String(s || "");
    maxLen = maxLen || 30;
    if (s.length <= maxLen) return s;
    return s.substring(0, maxLen) + "…";
  }

  // ---------- 状态徽标 ----------
  function chip(level, text) {
    var map = { ok: "通过", warn: "注意", bad: "风险" }; // v5.7: 移除从未使用的 info 级别
    return '<span class="chip ' + level + '">' + esc(text || map[level]) + "</span>";
  }

  // 缺失字体列表(带橙色三角感叹号)
  function renderMissingFonts(arr) {
    var items = arr.map(function (n) {
      return '<li class="missing-font"><span class="warn-tri">⚠</span> ' + esc(n) + "</li>";
    }).join("");
    // v5.17: 按用户要求去掉括号说明与"检测方式"灰字,只留名单
    return '<div>缺失字体 <b class="bad-t">' + arr.length + "</b> 个:</div>" +
      '<ul class="list">' + items + "</ul>";
  }

  // v5.16: 字体诊断行(fontDiagText)随根因确诊移除

  // chipLevel: 徽标自身的配色级别(可省略,默认沿用卡片级别)
  // v4.3: 卡 1 的"CMYK/RGB"徽标配色必须只跟色彩模式状态走,不能继承卡片级别
  //       ——否则出血不足(黄)会把 CMYK 徽标染黄,看起来像"色彩模式有问题"
  // v5.0: 新增 extraChip(可选)— 卡片右上角可并列第二个徽标(如卡1出血不足)
  function card(title, level, chipText, bodyHtml, chipLevel, extraChip) {
    return '<div class="card"><div class="card-head"><span>' + esc(title) + "</span><span class='chips'>" +
      chip(chipLevel || level, chipText) + (extraChip ? extraChip : "") + '</span></div><div class="card-body">' + bodyHtml + "</div></div>";
  }

  // v7.0: 标题行 + 右侧样本截断提示(与标题同一行、右对齐、不带括号)
  // 不带"共 N"是因为总数已经在标题的计数里,避免同一行重复报数
  function rowHead(leftHtml, hintText) {
    return '<div class="row-head"><span class="row-t">' + leftHtml + "</span>" +
      (hintText ? '<span class="row-h">' + esc(hintText) + "</span>" : "") + "</div>";
  }

  // ---------- 主流程 ----------
  // v8.0: keepNotice —— 操作后(转曲/嵌入)触发的刷新必须**保留**本次成功提示。
  //   旧版 showNotice() 之后立刻 run(),而 run() 第一件事就是清 #notice ⇒ 操作反馈一闪即没。
  //   手动点"开始检查"时不传(照旧清掉残留旧提示);提示本身仍由 showNotice 的 5 秒计时器收尾。
  function run(keepNotice) {
    if (!inCEP()) {
      showError("未检测到 CEP 环境。此页面需在 Illustrator 的扩展面板中运行。");
      return;
    }
    $("btnRun").disabled = true;
    $("loading").classList.remove("hidden");
    $("error").classList.add("hidden");
    // v5.2: 顺带清掉残留的旧成功提示,避免绿条挂在新一轮结果上
    // v8.0: 操作后刷新时保留(keepNotice=true)
    if (!keepNotice) $("notice").classList.add("hidden");
    $("results").innerHTML = "";
    $("foot").innerHTML = "";

    var timedOut = false;
    var timer = setTimeout(function () {
      timedOut = true;
      $("loading").classList.add("hidden");
      // v5.2 修复: 超时后必须恢复按钮,否则"开始检查"永久禁用,只能重开面板
      $("btnRun").disabled = false;
      // v8.1: 措辞改为"仍在继续" —— ExtendScript 无多线程,JSX 一旦开跑就停不下来;
      //   旧版在此宣告超时、回调又 `if (timedOut) return` 把已算完的结果丢掉 ⇒ 白转一场。
      showError("扫描时间较长(超过 20 秒)。文档对象可能较多，后台仍在继续，完成后会自动显示结果。");
    }, 20000);

    execJsx("runPreflight();", function (data, raw) {
      // v8.1: 不再因超时丢弃迟到的结果 —— 照常渲染,并补一条"耗时较长"提示
      clearTimeout(timer);
      $("btnRun").disabled = false;
      $("loading").classList.add("hidden");
      if (!data || !data.ok) {
        showError((data && data.error) ? data.error
          : ("脚本执行失败。请确认扩展目录中的 jsx/preflight.jsx 存在。返回: " +
             String(raw).substring(0, 120)));
        return;
      }
      try {
        render(data);
        if (timedOut) showNotice("扫描耗时较长，结果已更新。");
      } catch (renderErr) {
        showError("渲染出错 [" + JS_BUILD + "]: " + renderErr.message);
      }
    });
  }

  // v5.2: 报错时顺带隐藏成功提示,避免红绿两个提示框同屏
  function showError(msg) {
    var el = $("error");
    el.textContent = msg;
    el.classList.remove("hidden");
    $("notice").classList.add("hidden");
  }

  // 成功提示(绿色,5 秒后自动消失)
  // v5.2 修复: 计时器存变量,新提示先清掉旧的 —— 否则连续操作时
  // 第一条的计时器会把第二条刚显示的提示提前隐藏
  var noticeTimer = null;
  function showNotice(msg) {
    var el = $("notice");
    if (!el) return;
    el.textContent = msg;
    el.classList.remove("hidden");
    $("error").classList.add("hidden");
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(function () { el.classList.add("hidden"); }, 5000);
  }

  // ---------- 渲染 ----------
  function render(d) {
    lastDocKey = docKey(d); // v5.6: 记录文档指纹,供焦点切换比对
    // v3.9: 文件名/路径/构建号统一放底部 footer(原顶部信息条已移除)
    var foot = $("foot");
    // v7.2: 去掉常显的"JS构建 <戳>"——平时只是调试信息(版本号顶栏 <span class="ver"> 已可见;
    //       出错时 showError 仍会带上构建号)。footer 只留文件名/路径/符号提示。
    foot.innerHTML =
      '<span class="fname">' + esc(d.docName) + "</span>" +
      (d.docPath ? '<span class="fpath">' + esc(d.docPath) + "</span>" : "") +
      // v4.8: 符号内部扫描提示(仅当文档含符号时)
      (d.symbols && d.symbols.count > 0
        ? '<span class="fbuild">符号 ' + d.symbols.count + " 个" +
          (d.symbols.scanned ? "(已扫描内部内容)" : "(内部不可访问)") + "</span>" : "");

    var html = "";

    // ===== 1. 画板 · 出血 · 色彩(v4.0: 色彩模式并入,原第2项移除) =====
    var cmOk = d.colorMode === "CMYK";
    var abRows = "";
    for (var i = 0; i < d.artboards.length; i++) {
      var a = d.artboards[i];
      abRows += "<tr><td>" + esc(a.name) + (i + 1 === d.activeArtboard ? ' <span class="dim">(当前)</span>' : "") +
        '</td><td class="mono">' + bnum(a.w) + " × " + bnum(a.h) + " mm</td></tr>";
    }
    var bleedLevel = "ok";
    function bnum(v) { return (typeof v === "number" && isFinite(v)) ? v : 0; }
    // 出血不足 3mm 的画板名单(v3.4: 多画板文档逐板实测,只列有问题的)
    var bleedHtml = "";
    var bl = (d.bleed && d.bleed.artboards) ? d.bleed : null;
    if (bl && bl.supported) {
      var badAbs = [];
      for (var bi = 0; bi < bl.artboards.length; bi++) {
        var ba = bl.artboards[bi];
        if (ba.insufficient) {
          // v4.5: 列出该画板所有 <3mm 的边(如"上 0mm、下 0mm、右 2.9mm")
          var es = "";
          if (ba.shortEdges && ba.shortEdges.length) {
            es = ba.shortEdges.map(function (e) {
              return e.edge + " " + bnum(e.mm) + "mm";
            }).join("、");
          } else {
            es = (ba.worstEdge ? ba.worstEdge + " " : "最小边 ") + bnum(ba.minMm) + "mm";
          }
          badAbs.push("<li>" + esc(ba.name) + " <span class='dim'>(" + es + ")</span></li>");
        }
      }
      if (badAbs.length) {
        bleedLevel = "warn";
        bleedHtml = '<div>出血不足 3mm 的画板 <b class="warn-t">' + badAbs.length + "</b> 个:</div>" +
          '<ul class="list">' + badAbs.join("") + "</ul>";
      } else {
        bleedHtml = '出血全部 ≥ 3mm，<b class="good">达标</b>。';
      }
    } else {
      bleedHtml = '<span class="dim">无法测量</span>';
    }
    // 合并级别: RGB(坏)优先于出血(黄) — bad > warn > ok
    var c1Level = cmOk ? bleedLevel : "bad";
    // v4.0 形态A: 色彩模式永远平铺一行
    var cmHtml = cmOk
      ? '<div>色彩模式: <b class="white">CMYK</b></div>'
      : '<div>色彩模式: <b class="bad-t">RGB</b> · 请转 CMYK (文件 → 文档颜色模式)。</div>';
    // v4.3: 徽标配色由色彩模式自身决定(CMYK=绿 / RGB=红),
    // 左边条颜色才代表整卡状态(出血不足=黄 / RGB=红),两者解耦
    // v5.0: 出血不足时右上角追加"出血不足"徽标(黄底),与色彩徽标并列
    var bleedChip = (bleedLevel === "warn" && badAbs.length > 0)
      ? chip("warn", "出血不足") : "";
    html += card("画板 · 出血 · 色彩", c1Level, cmOk ? "CMYK" : "RGB",
      '<table class="kv">' + abRows + "</table>" + bleedHtml + cmHtml,
      cmOk ? "ok" : "bad", bleedChip);

    // ===== 2. 隐藏对象 =====
    var hd = d.hidden || { layerCount: 0, itemCount: 0, layerNames: [], truncated: false };
    var hdTotal = (hd.layerCount || 0) + (hd.itemCount || 0);
    var hdLevel = hdTotal > 0 ? "warn" : "ok";
    var hdHtml = "";
    if (hdTotal === 0) {
      // v7.1: 去掉冗余的"未发现"——卡片标题已表明检查项,正文直说状态
      hdHtml = '无 <b class="white">隐藏图层 / 隐藏对象</b>。';
    } else {
      var hdHint = (hd.layerNames && hd.layerCount > hd.layerNames.length) ? "仅列出前 5 个" : "";
      // v7.1: 去掉冗余的"发现"
      hdHtml = rowHead('隐藏图层 <b class="warn-t">' + (hd.layerCount || 0) + "</b> 个 · 隐藏对象 <b class='warn-t'>" +
        (hd.itemCount || 0) + "</b> 个。", hdHint);
      if (hd.layerNames && hd.layerNames.length) {
        hdHtml += '<ul class="list">' + hd.layerNames.map(function (n) { return "<li>图层 " + esc(n) + "</li>"; }).join("") + "</ul>";
      }
      // v5.18: "隐藏内容不会出现在导出结果中…"提示灰字按用户要求移除
      // v7.1: 配额提示去掉"对象过多,"前缀(与"仅扫描前 N"语义重复)
      if (hd.truncated) hdHtml += '<div class="dim">(仅扫描前 3000 个)</div>';
    }
    // v5.20: 有隐藏内容时徽标转红(左边条维持黄色,仅徽标级别改 bad)
    html += card("隐藏对象", hdLevel, hdTotal > 0 ? hdTotal + " 个" : "无", hdHtml, hdTotal > 0 ? "bad" : "ok");

    // ===== 3. 字体转曲 =====
    // v5.14: 转曲状态与缺失字体是两个独立状态,徽标并列显示(修 bug: 原三目
    // 二选一,"未转曲 8 个"与"缺字体 1"只能显示一个);同卡 1 的双徽标形态
    var fHtml = "", fLevel, fChip, fChipLevel;
    var missingFonts = (d.fonts && d.fonts.missingFonts) ? d.fonts.missingFonts : [];
    var hasMissing = missingFonts.length > 0;
    var missChip = hasMissing ? chip("bad", "缺字体 " + missingFonts.length) : "";
    var tinyChip = "";
    // v5.24: htx 提前计算——全转曲文案与徽标合并计数都要用
    var htx = (d.hiddenText && d.hiddenText.count > 0) ? d.hiddenText : null;
    if (d.fonts.outlined) {
      fLevel = hasMissing ? "bad" : "ok";
      fChip = "已转曲";
      fChipLevel = "ok"; // 转曲状态本身是好的,徽标不跟随卡片红色;缺失风险由并列徽标承担
      // v5.24: 文案改单句"可见文字 已全部转曲，另有 N 个隐藏文字未转曲"
      fHtml = '可见文字 <b class="good">已全部转曲</b>';
      fHtml += htx ? '，另有 <b class="warn-t">' + htx.count + '</b> 个隐藏文字未转曲。' : '。';
      // v5.18: "隐藏图层/对象中的文字未计入…"提示灰字按用户要求移除
      if (hasMissing) fHtml += renderMissingFonts(missingFonts);
    } else {
      fLevel = "bad";
      fChip = "未转曲 " + d.fonts.totalText + " 个";
      fChipLevel = "bad";
      // v7.1: 去掉冗余的"发现"与"涉及"
      var parts = '<b class="warn-t">' + d.fonts.totalText + "</b> 个未转曲文本框";
      if (d.fonts.names.length) {
        // v5.0: 字体名可能超长(罕见),同样单行截断+title 悬停看全名
        // v5.6/F4: 字体种类封顶,超出折叠为"等 N 种"(多字体文档不再拉长卡片)
        // v5.19: 封顶 15→8
        var shown = d.fonts.names.slice(0, 8);
        var extra = d.fonts.names.length - shown.length;
        parts += '，字体:<ul class="list">' + shown.map(function (n) {
          var full = decodeImgName(n);
          return '<li class="trunc" title="' + esc(full) + '">' + esc(truncName(full, 34)) + "</li>";
        }).join("") + (extra > 0 ? '<li class="dim">…等 ' + extra + " 种</li>" : "") + "</ul>";
      }
      if (hasMissing) parts += renderMissingFonts(missingFonts);
      fHtml = parts;
      if (d.fonts.truncated) fHtml += '<div class="dim">(仅扫描前 3000 个)</div>';
    }
    // v5.15: 极小字号,并入字体卡底部
    // v6.8: 分两级——<6pt 计数黄、其中 <5pt 计数红;徽标"有 <5pt 才红,否则黄"
    // v6.9: 有 <5pt 时总数数字一并转红(与徽标同级别);样本截断提示按用户要求删除
    var tiny = (d.tiny && d.tiny.count > 0) ? d.tiny : null;
    if (tiny) {
      var tinyBad = tiny.badCount || 0;
      // v5.17: 去掉小标题与建议灰字,只留计数与样本
      // v7.0: 截断提示回到标题行右侧(同一行、右对齐、不带括号)
      var tinyHint = (tiny.count > tiny.samples.length) ? "仅列出前 5 处" : "";
      // v7.1: 去掉冗余的"发现"与"的文字"
      fHtml += rowHead('<b class="' + (tinyBad > 0 ? "bad-t" : "warn-t") + '">' + tiny.count + "</b> 处字号小于 6pt:", tinyHint) +
        '<ul class="list">' + tiny.samples.map(function (s) {
          return '<li class="trunc" title="' + esc(s.t) + '">' + esc(s.t) + " — " + s.pt + "pt</li>";
        }).join("") + "</ul>";
      // v6.8: <5pt 重度——补一行红字计数(嵌套在 <6pt 之内,不重复列样本)
      if (tinyBad > 0) {
        fHtml += '其中 <b class="bad-t">' + tinyBad + "</b> 处小于 5pt。";
        tinyChip = chip("bad", "小字号 " + tiny.count);
        fLevel = "bad";
      } else {
        tinyChip = chip("warn", "小字号 " + tiny.count);
      }
    }
    // v5.21: 隐藏文字统计(树遍历只扫可见,隐藏的单独列出;字体名已并入缺失检测)
    // v5.22: 文案理顺——隐藏文字必然未转曲(转曲了就不是文本框),直接说明
    // v5.24: 不再单列"隐文 N"徽标(并入下方合并计数);未转曲分支保留"勾选显示全部"引导
    if (htx && !d.fonts.outlined) {
      fHtml += '另有 <b class="warn-t">' + htx.count + "</b> 个隐藏文字未转曲" +
        (htx.missingCount > 0 ? "(缺字体 <b class='bad-t'>" + htx.missingCount + "</b> 个)" : "") +
        '，勾选"显示全部"可一并转曲。';
      if (htx.truncated) fHtml += '<div class="dim">(仅统计前 500 个)</div>';
    }
    // v5.24: 徽标合并计数——可见未转曲 + 隐藏文字合并为一个"未转曲 N 个"
    var totalOutline = d.fonts.totalText + (htx ? htx.count : 0);
    if (totalOutline > 0) {
      fChip = "未转曲 " + totalOutline + " 个";
      fChipLevel = "bad";
      fLevel = "bad";
    }
    // 一键转曲区(有未转曲文本框时显示)
    // 默认勾选"显示""解锁",此时转曲前会先解除隐藏/锁定(含图层与对象);
    // 取消某一项则保持该类状态不变,对应文字跳过不转
    // v5.22: 可见文字全转曲但存在隐藏文字时,按钮照常显示(否则提示勾选转曲却没有按钮)
    if (d.fonts.totalText > 0 || htx) {
      fHtml += '<div class="action-row">' +
        '<div class="chk-row">' +
        '<label class="chk" title="显示隐藏图层，并取消对象级隐藏(Ctrl+3)"><input type="checkbox" id="chkShowAll"> 显示全部</label>' +
        '<label class="chk" title="解锁图层，并解除对象级锁定(Ctrl+2)与锁定组"><input type="checkbox" id="chkUnlockAll"> 解锁全部</label>' +
        '</div>' +
        '<button class="btn-action" id="btnOutline">一键转曲</button>' +
        '</div>';
    }
    html += card("字体转曲", fLevel, fChip, fHtml, fChipLevel, missChip + tinyChip);

    // ===== 4. 图片嵌入 =====
    // v5.15: 缺失链接——源文件不存在的链接图计数、清单标红、徽标转"缺失 N 张"
    var missN = d.images.missingCount || 0;
    var iLevel = d.images.linkedCount > 0 ? "bad" : "ok";
    var iHtml = "嵌入图片: <b>" + d.images.embeddedCount + "</b> 张 · 链接图片: <b class='" +
      (d.images.linkedCount ? "bad-t" : "good") + "'>" + d.images.linkedCount + "</b> 张" +
      (missN ? " · 缺失链接: <b class='bad-t'>" + missN + "</b> 张" : "");
    if (d.images.linked.length) {
      // v7.0: 截断提示与小标题同一行、右对齐
      var iHint = (d.images.linkedCount > d.images.linked.length) ? "仅列出前 5 张" : "";
      // v7.1: 小标题去掉与"链接图片"重复的括注(上方汇总行已有"链接图片: N 张")
      iHtml += rowHead('<span class="section-sub">未嵌入:</span>', iHint);
      // v5.0: 链接文件名(name/file 路径)可能超长或 URL 编码,解码+单行截断
      // v5.19: 两行并一行——只显示文件名,完整路径移到悬停 title,清单高度减半
      iHtml += '<ul class="list">' + d.images.linked.map(function (it) {
        var fn = decodeImgName(it.name);
        var ff = decodeImgName(it.file);
        return '<li class="trunc" title="' + esc(ff) + '">' + (it.missing ? '<span class="warn-tri">⚠</span> ' : "") +
          esc(truncName(fn, 40)) + (it.missing ? ' <span class="bad-t">源文件不存在</span>' : "") + "</li>";
      }).join("") + "</ul>";
      // v6.9: 样本截断提示按用户要求删除(truncated 仍代表扫描配额上限,提示保留)
      if (d.images.truncated) iHtml += '<div class="dim">(仅扫描前 3000 张)</div>';
    }
    // 一键嵌入按钮
    if (d.images.linkedCount > 0) {
      iHtml += '<div class="action-row"><button class="btn-action" id="btnEmbed">一键嵌入</button></div>';
    }
    html += card("图片嵌入", iLevel, missN > 0 ? ("缺失 " + missN + " 张") : (d.images.linkedCount > 0 ? "有链接图" : "全部嵌入"), iHtml);

    // ===== 5. 图片分辨率 =====
    var rs = d.resolution || { total: 0, lowCount: 0, okCount: 0, samples: [], truncated: false };
    var rsLevel = rs.lowCount > 0 ? "warn" : "ok";
    var rsHtml = "";
    if (rs.total === 0) {
      rsHtml = '文档<span class="dim">无位图</span>。';
    } else {
      // v7.0: 截断提示与汇总行同一行、右对齐
      var rsHint = (rs.lowCount > rs.samples.length) ? "仅列出前 5 张" : "";
      rsHtml = rowHead("共 <b>" + rs.total + "</b> 张图片 · 达标 <b class='good'>" + rs.okCount + "</b> 张 · <300ppi <b class='" +
        (rs.lowCount ? "warn-t" : "") + "'>" + rs.lowCount + "</b> 张", rsHint);
      if (rs.samples.length) {
        // v5.0: 文件名先 URL 解码再截断显示;完整名放 title(悬停可查)
        rsHtml += '<ul class="list">' + rs.samples.map(function (s) {
          var full = decodeImgName(s.name);
          var shown = truncName(full, 34);
          // v8.2: jsx 的 ppiOf 返回**原值**(带小数,为的是卡 300 阈值时不误判),显示时统一取整
          //   —— 与油墨 total 同一口径(jsx 传原值 / 前端 Math.round)。
          //   旧版(≤v8.1)这里直接输出 s.ppi ⇒ 面板上出现 "170.776863599299 ppi" 这种长小数。
          var ppiShow = (typeof s.ppi === "number" && isFinite(s.ppi)) ? Math.round(s.ppi) : s.ppi;
          return '<li class="trunc" title="' + esc(full) + '">' + esc(shown) + " — " + ppiShow + " ppi</li>";
        }).join("") + "</ul>";
      }
      // v6.9: 样本截断提示按用户要求删除
      if (rs.truncated) rsHtml += '<div class="dim">(仅扫描前 3000 张)</div>';
      // v5.18: "低于 300ppi…建议更换高清图源"提示灰字按用户要求移除
    }
    html += card("图片分辨率", rsLevel, rs.lowCount > 0 ? "有 " + rs.lowCount + " 张偏低" : "全部达标", rsHtml);

    // ===== 6. 油墨 · 描边粗细 (v6.2: 方案 B —— 按"问题类型"分块,标题统一) =====
    var bt = d.black.text, bp = d.black.path;
    var bHtml = "";
    var bLevel = "ok";
    var bChip = "通过";
    var totalBad = bt.bad + bp.bad;
    var totalWarn = bt.warn + bp.warn;
    var light = d.black.light || { count: 0, samples: [] };
    var lightN = light.count || 0;
    var thinN = bp.thin || 0;
    // v8.3: 叠印(文字+图形共一池)—— 计数只走"分块 + extraChip",**不并入主徽标计数**
    var ovp = d.black.overprint || { count: 0, samples: [] };
    var ovpN = ovp.count || 0;

    // v6.3: CMYK 四色分量左对齐——C/M/Y/K 各列补齐到 4 字符(最多 3 位数),
    //   填充用不换行空格 U+00A0(HTML 会把连续普通空格折叠成一个,补不齐)
    var NBSP = "\u00A0";
    var LIGHT_CH = 5;   // 与 jsx 的 LIGHT_CH 同口径:某分量 0<值<5 判为色版过浅
    function padInkDesc(desc) {
      var m = /^C(\d+) M(\d+) Y(\d+) K(\d+)$/.exec(String(desc == null ? "" : desc));
      if (!m) return desc;   // 非标准四色(Gray 的 "K50" / RGB / 专色)原样不动
      var out = [];
      for (var i = 1; i <= 4; i++) {
        var f = "CMYK".charAt(i - 1) + m[i];
        while (f.length < 4) f += NBSP;
        out.push(f);
      }
      return out.join(" ");
    }
    // v7.6: 把四色串里"值在 1~4"的分量单独包一层 <b class="ink-w">,面板用白色显示
    //   —— 直接指出是哪一个色版太浅(如 C0 M0 Y0 K2 只有 K2 是白的;
    //      C50 M50 Y2 K100 里只有 Y2 是白的)。
    //   与 padInkDesc 同一套正则、同一套定宽补齐 ⇒ 分量字符宽度不变,行内 "=" 列对齐不受影响。
    //   0(该色版不用) 与 ≥5(正常) 保持常规灰;非标准色(Gray/RGB/专色)原样转义。
    function markLightChannels(desc) {
      var m = /^C(\d+) M(\d+) Y(\d+) K(\d+)$/.exec(String(desc == null ? "" : desc));
      if (!m) return esc(desc);
      var out = [];
      for (var i = 1; i <= 4; i++) {
        var f = "CMYK".charAt(i - 1) + m[i];
        var pad = "";
        while ((f + pad).length < 4) pad += NBSP;
        var v = parseInt(m[i], 10);
        out.push((v > 0 && v < LIGHT_CH) ? '<b class="ink-w">' + f + "</b>" + pad : f + pad);
      }
      return out.join(" ");
    }
    // 样本行: [来源] 名称 填充/描边 内容 [= 总量] [×n]
    // v6.2: jsx 已把样本结构化;这里保留字符串兜底(防旧 jsx 缓存)
    // v7.6: 第 3 参 markLight=true 时走 markLightChannels(把过浅分量标白),目前仅"色版1~4%"块开启。
    // v7.7: 第 4 参 n>1 时行尾追加 " ×n"(同源同色合并计数,与描边块 "0.09mm ×3" 同款)。
    function inkLi(srcLabel, s, markLight, n) {
      if (typeof s === "string") s = { name: "", where: "", desc: s };
      var head = "[" + srcLabel + "] " + (s.name ? s.name + " " : "") +
                 (s.where ? s.where + " " : "");
      var padded = padInkDesc(s.desc);
      // v8.0: jsx 的分档改用 CMYK 原值求和(带小数),这里显示时统一四舍五入回整数,
      //       ⇒ 面板上仍是 "= 308" 这种整数,与 desc 里的分量口径一致
      var tail = s.total !== undefined ? " = " + Math.round(s.total) : "";
      var cnt = (n && n > 1) ? " ×" + n : "";
      return '<li class="trunc" title="' + esc(head + padded + tail + cnt) + '">' +
             esc(head) + (markLight ? markLightChannels(s.desc) : esc(padded)) + esc(tail) + esc(cnt) + "</li>";
    }
    // 问题块标题: 名称 N 处
    // v6.4: 改"数字染色"——标题文字取常规色,只有计数 N 上黄/红(与全站规则一致)
    // v7.0: 第 4 参 hint 为样本截断提示,渲染在标题同一行最右(不带括号)
    function inkBlock(name, n, lvl, hint) {
      return '<div class="ink-block"><span class="row-t">' + esc(name) + ' <b class="' +
        (lvl === "bad" ? "bad-t" : "warn-t") + '">' + n + "</b> 处</span>" +
        (hint ? '<span class="row-h">' + esc(hint) + "</span>" : "") + "</div>";
    }
    // v7.7: 相同样本合并成一行(行尾 " ×n"),再截到前 cap 组。
    // v7.8: jsx 已改成"按不同值收"并在样本上带 n(= 文档全量出现次数)。因此:
    //   ① 入池样本天然互不相同 ⇒ 分组基本是 1 条 1 组,cap 不再吃掉不同的色值(能填满 5 行);
    //   ② 计数**优先取 s.n**(全量真值,不受采样池限制);旧 jsx 缓存里没有 n 时才按 1 条累计。
    // v7.9: 有 total 的块(油墨总量两块)先按 total 从高到低全局排序再截断 → 面板上数字单调递减。
    //   rows: [{l:"文字"|"图形", s:样本, markLight:bool}]
    //   分组键 = 来源标签 + 名称 + 填充/描边 + 色值 + 总量 —— 只有"完全一样"才合并;
    //   不跨 [文字]/[图形] 合并,也不因名称不同而强行并成一条。
    //   返回 {html, shown}: shown = 屏幕上实际体现了多少"原始样本条数"(供截断提示判断);
    //   合并后 5 行可涵盖 >5 条原始样本,故提示条件须与 shown 比,不能与"行数"比。
    function inkRows(rows, cap) {
      var order = [], map = {}, i, r, s, key, g;
      for (i = 0; i < rows.length; i++) {
        r = rows[i]; s = r.s;
        key = r.l + "\u0001" + (s.name || "") + "\u0001" + (s.where || "") +
              "\u0001" + s.desc + "\u0001" + (s.total === undefined ? "" : s.total);
        if (!map[key]) { map[key] = { l: r.l, s: s, ml: !!r.markLight, n: 0 }; order.push(key); }
        map[key].n += (s.n > 0 ? s.n : 1);   // 有 n 用 n(全量真值);无 n(旧 jsx)按 1 条累计
      }
      // v7.9: 油墨总量块按"从高到低"展示。jsx 里 文字/图形 是两个独立的池(各自 top-5),
      //   拼起来跨来源就不单调了 —— 这里合并后再全局排一次,保证数字真正递减;
      //   色版1~4% 块的样本没有 total,比较值为 -Infinity ⇒ 稳定排序保持原顺序,不受影响。
      order.sort(function (a, b) {
        var ta = map[a].s.total, tb = map[b].s.total;
        if (ta === undefined) ta = -Infinity;
        if (tb === undefined) tb = -Infinity;
        return tb - ta;
      });
      var use = (cap && order.length > cap) ? order.slice(0, cap) : order;
      var out = '<ul class="list">', shown = 0;
      for (i = 0; i < use.length; i++) {
        g = map[use[i]];
        shown += g.n;
        out += inkLi(g.l, g.s, g.ml, g.n);
      }
      out += "</ul>";
      return { html: out, shown: shown };
    }
    // v6.7: 合并"文字样本 + 图形样本"为一张表(文字在前),分组合并与截断统一交给 inkRows。
    //   此前两类样本各自拼接、最多 10 行,但截断提示只写了"前 5",与实际不符;现按用户口径真截到前 5 组。
    function inkMerge(a, b, cap) {
      var rows = [], i;
      for (i = 0; i < (a || []).length; i++) rows.push({ l: "文字", s: a[i] });
      for (i = 0; i < (b || []).length; i++) rows.push({ l: "图形", s: b[i] });
      return inkRows(rows, cap);
    }

    var blocks = "";
    // 块 1: 油墨总量>300(红) —— 文字 + 图形样本合并成一张表,按来源标 [文字]/[图形]
    if (totalBad > 0) {
      var badRows = inkMerge(bt.badSamples, bp.badSamples, 5); // v6.7: 合并后统一截到前 5 条
      blocks += inkBlock("油墨总量>300", totalBad, "bad", totalBad > badRows.shown ? "仅列出前 5 处" : "");
      blocks += badRows.html;
    }
    // 块 2: 油墨总量 220~300(黄)
    if (totalWarn > 0) {
      var warnRows = inkMerge(bt.warnSamples, bp.warnSamples, 5); // v6.7: 合并后统一截到前 5 条
      blocks += inkBlock("油墨总量220~300", totalWarn, "warn", totalWarn > warnRows.shown ? "仅列出前 5 处" : "");
      blocks += warnRows.html;
    }
    // 块 3: 色版 1~4%(黄,CMYK 某分量) —— 用户指定排在描边块之前
    if (lightN > 0) {
      var lightRows = (light.samples || []).map(function (s) {
        return { l: s.src === "text" ? "文字" : "图形", s: s, markLight: true };  // v7.6: 过浅分量标白
      });
      var lightOut = inkRows(lightRows, 5);   // v7.7: 相同色值合并为 " ×n"
      blocks += inkBlock("色版1~4%", lightN, "warn", lightN > lightOut.shown ? "仅列出前 5 处" : "");
      blocks += lightOut.html;
    }
    // 块 4(v8.3): 叠印(红) —— 文字/图形共一池,按不同色值 ×n(与"色版1~4%"同款渲染)
    if (ovpN > 0) {
      var ovpRows = (ovp.samples || []).map(function (s) {
        return { l: s.src === "text" ? "文字" : "图形", s: s };
      });
      var ovpOut = inkRows(ovpRows, 5);
      blocks += inkBlock("叠印", ovpN, "bad", ovpN > ovpOut.shown ? "仅列出前 5 处" : "");
      blocks += ovpOut.html;
    }
    // 块 5: 描边<0.1mm(黄,仅图形) —— 相同宽度合并为 "描边 0.09mm ×3"
    // v7.8: jsx 已按 mm 去重并带 n(全量次数);这里仍按 mm 分组(旧 jsx 兜底),计数优先取 s.n
    if (thinN > 0) {
      blocks += inkBlock("描边<0.1mm", thinN, "warn", thinN > bp.thinSamples.length ? "仅列出前 5 处" : "");
      var tOrder = [], tMap = {};
      (bp.thinSamples || []).forEach(function (s) {
        var k = String(s.mm);
        if (!tMap[k]) { tMap[k] = { mm: s.mm, n: 0, names: [] }; tOrder.push(k); }
        tMap[k].n += (s.n > 0 ? s.n : 1);   // 有 n 用 n(全量真值);无 n(旧 jsx)按 1 条累计
        if (s.name) tMap[k].names.push(s.name);
      });
      blocks += '<ul class="list">' + tOrder.map(function (k) {
        var g = tMap[k];
        var txt = "[图形] " + (g.names.length ? g.names.join(" ") + " " : "") +
                  "描边 " + g.mm + "mm" + (g.n > 1 ? " ×" + g.n : "");
        return '<li class="trunc" title="' + esc(txt) + '">' + esc(txt) + "</li>";
      }).join("") + "</ul>";
    }

    // 汇总行(灰):正常计数 + RGB/专色/混合色
    var rgbN = bt.rgb + bp.rgb, spotN = bt.spot + bp.spot, mixedN = bt.mixed + bp.mixed;
    var rest = "正常:文字 <b class='ink-n'>" + bt.ok + "</b> · 图形 <b class='ink-n'>" + bp.ok + "</b>";
    if (rgbN) rest += " · RGB <b class='warn-t'>" + rgbN + "</b>";
    if (spotN) rest += " · 专色 <b>" + spotN + "</b>";
    if (mixedN) rest += " · 混合色 <b>" + mixedN + "</b>";
    if (bp.truncated) rest += " · 仅扫描前 3000 个";
    blocks += '<div class="ink-rest">' + rest + "</div>";
    bHtml = blocks;

    // 徽标: 主徽标只管"油墨总量 + 描边<0.1mm + 色版1~4%"(描边/色版并入"注意 N 处"黄标)
    var totalWarnAll = totalWarn + thinN + lightN;
    if (totalBad > 0) { bLevel = "bad"; bChip = "超标 " + totalBad + " 处"; }
    else if (totalWarnAll > 0) { bLevel = "warn"; bChip = "注意 " + totalWarnAll + " 处"; }
    // v8.3: 叠印另走 extraChip(第 6 参),**不并入上面计数** —— 主徽标仍只管油墨/描边。
    //   第 5 参传 null ⇒ chipLevel||level,主徽标配色与旧版完全一致。
    var ovpChip = ovpN > 0 ? chip("bad", "有叠印") : "";
    html += card("油墨 · 叠印 · 描边粗细", bLevel, bChip, bHtml, null, ovpChip);

    $("results").innerHTML = html;

    // 复选框状态回填 + 变更保存(面板重绘后保持用户选择)
    // v5.6: 变更同步写入 localStorage,跨面板重开也保持
    var cs = $("chkShowAll"), cu = $("chkUnlockAll");
    if (cs) {
      cs.checked = CHK_SHOW;
      cs.onchange = function () {
        CHK_SHOW = cs.checked;
        try { localStorage.setItem("pf_chkShow", cs.checked ? "1" : "0"); } catch (e) {}
      };
    }
    if (cu) {
      cu.checked = CHK_UNLOCK;
      cu.onchange = function () {
        CHK_UNLOCK = cu.checked;
        try { localStorage.setItem("pf_chkUnlock", cu.checked ? "1" : "0"); } catch (e) {}
      };
    }
  }

  // ---------- 执行 JSX 操作并刷新 ----------
  // v5.6/F7: 执行期间禁用按钮+显示 loading,防连点排队重复执行
  var actionBusy = false;
  function execAction(jsxFns, successMsg) {
    if (actionBusy) return;
    actionBusy = true;
    $("btnRun").disabled = true;
    $("loading").classList.remove("hidden");
    var btns = document.querySelectorAll(".btn-action");
    for (var bi = 0; bi < btns.length; bi++) btns[bi].disabled = true;
    execJsx(jsxFns, function (data, raw) {
      actionBusy = false;
      if (data && data.ok) {
        // v7.1: 不再"成功词 + 详情"两句并排(原为"转曲完成。 已转曲 5 个文本框。")——
        // 有 jsx 详情就只用详情,没有才退回成功词
        showNotice(data.message || successMsg || "操作完成");
      } else {
        showError((data && data.error) ? data.error
          : ("操作失败。返回: " + String(raw).substring(0, 120)));
      }
      run(true); // v8.0: 刷新检查结果(保留本次操作的成功提示;内部会恢复按钮、隐藏 loading)
    });
  }

  // 转曲前的图层处理选项(默认勾选;面板重绘后状态保留)
  // v5.6: 状态持久化到 localStorage,重开面板保持上次选择(读取失败保持默认)
  var CHK_SHOW = true, CHK_UNLOCK = true;
  try {
    if (localStorage.getItem("pf_chkShow") !== null) CHK_SHOW = localStorage.getItem("pf_chkShow") === "1";
    if (localStorage.getItem("pf_chkUnlock") !== null) CHK_UNLOCK = localStorage.getItem("pf_chkUnlock") === "1";
  } catch (eLS) {}

  // v5.6/体验①: 上次结果的文档指纹;面板获得焦点时比对,切换了文档就自动重扫
  var lastDocKey = null;
  function docKey(d) { return d.docName + "|" + d.docPath; }
  // v8.1: 原 lastData(保存最近检查结果供确认框读 linkedAll/linkedHidden)已移除 ——
  //   嵌入范围改为点"嵌入"时调 pfLinkScope() 现取(见 onEmbed),不再依赖上次检查结果。

  // 自定义确认框(替代原生 confirm: 原生无法改配色/按钮文字/字号)
  // 黑色主题 + 中文大按钮; 回车=确定, Esc=取消
  function customConfirm(msg, onOk) {
    var mask = $("modalMask"), msgEl = $("modalMsg");
    var okBtn = $("modalOk"), cancelBtn = $("modalCancel");
    if (!mask || !msgEl || !okBtn || !cancelBtn) { if (onOk) onOk(); return; }
    msgEl.textContent = msg;
    mask.classList.remove("hidden");
    function done(ok) {
      mask.classList.add("hidden");
      okBtn.onclick = null; cancelBtn.onclick = null;
      document.removeEventListener("keydown", onKey, true);
      if (ok && onOk) onOk();
    }
    function onKey(e) {
      if (e.key === "Enter") done(true);
      else if (e.key === "Escape") done(false);
    }
    okBtn.onclick = function () { done(true); };
    cancelBtn.onclick = function () { done(false); };
    document.addEventListener("keydown", onKey, true);
  }

  function onOutline() {
    var showAll = $("chkShowAll") ? $("chkShowAll").checked : CHK_SHOW;
    var unlockAll = $("chkUnlockAll") ? $("chkUnlockAll").checked : CHK_UNLOCK;
    var action = "";
    if (unlockAll && showAll) action = "将解锁全部图层与锁定对象(Ctrl+2/锁定组)，并显示隐藏图层与隐藏对象(Ctrl+3)，然后转曲文档中全部文字。";
    else if (showAll) action = "将显示全部图层与隐藏对象(不解锁)，然后转曲其中可见且未锁定的文字。";
    else if (unlockAll) action = "将解锁全部图层与锁定对象(Ctrl+2/锁定组)，不改动显示状态，然后转曲其中可见的文字。";
    else action = "将只转曲本就可见且未锁定的文字，不改动图层与对象状态。";
    customConfirm(action + "\n此操作不可撤销，确定继续?", function () {
      execAction("pfOutlineAll(" + showAll + ", " + unlockAll + ");", "转曲完成。");
    });
  }
  // v8.1: 嵌入范围改为"点嵌入时按需统计" —— 旧版读本轮检查结果里的 linkedAll/linkedHidden,
  //   而那两个数是每轮检查都做一遍的全文档 placedItems 遍历,只为这个确认框服务(用户极少点)。
  //   现改为点按钮时现调 pfLinkScope();取数失败退回泛化文案,绝不阻断嵌入。
  var embedProbing = false; // 防连点:取数期间再点直接忽略
  function onEmbed() {
    if (embedProbing) return;
    embedProbing = true;
    execJsx("pfLinkScope();", function (data) {
      embedProbing = false;
      var nAll = (data && data.ok && data.all) || 0;
      var nHid = (data && data.ok && data.hidden) || 0;
      // v8.0: ① 如实说明范围 —— 嵌入走文档级"全部链接图"(**含隐藏对象**),与检查卡的可见口径不同,
      //          旧文案只说"所有链接图片",用户看到的"链接图片 N 张"与实际嵌入数对不上;
      //       ② 预警矢量链接(PDF/AI/EPS)会被 300dpi 栅格化拼合为位图(不可逆:丢分层/矢量文字)。
      var scope = nAll > 0
        ? ("将嵌入文档中全部 " + nAll + " 张链接图" +
           (nHid > 0 ? "(其中 " + nHid + " 张为隐藏对象)" : "") + "。")
        : "将嵌入文档中所有链接图片。";
      customConfirm(scope +
        "\nPDF / AI / EPS 矢量链接会按 300dpi 栅格化为位图(不再保留矢量)。" +
        "\n此操作不可撤销，确定继续?", function () {
        execAction("pfEmbedAll();", "嵌入完成。");
      });
    });
  }

  // 事件委托: 处理动态生成的按钮
  document.addEventListener("click", function (e) {
    var t = e.target;
    if (t && t.id === "btnOutline") onOutline();
    else if (t && t.id === "btnEmbed") onEmbed();
  });

  // ---------- 启动 ----------
  document.addEventListener("DOMContentLoaded", function () {
    // v8.0: 必须包一层 —— 若直接把 run 当监听器,浏览器会把 click 事件对象传进第 1 参(keepNotice),
    //       事件对象恒为真 ⇒ 手动点"开始检查"也会保留旧提示(不再是"清残留"语义)
    $("btnRun").addEventListener("click", function () { run(); });
    if (inCEP()) run(); // 打开面板自动检查一次
    // v5.6/体验①: 面板获得焦点时探测当前文档指纹,与上次结果不一致(切换了文档)则自动重扫
    window.addEventListener("focus", function () {
      if (actionBusy || $("btnRun").disabled) return;
      execJsx("pfDocKey();", function (data) {
        if (data && data.ok && data.key && lastDocKey && data.key !== lastDocKey) run();
      });
    });
  });
})();
