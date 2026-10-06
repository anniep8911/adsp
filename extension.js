"use strict";

const vscode = require("vscode");

const COMMAND_ID = "jspTab4Formatter.format";
const TAB = "\t";

const VOID_TAGS = new Set([
	"br", "img", "input", "hr", "meta", "link", "area", "base",
	"col", "embed", "param", "source", "track", "wbr"
]);

// 닫힘 태그가 생략될 수 있는 태그 (같은 형제 태그가 다시 열리면 이전 것을 닫는다)
const AUTO_CLOSE = {
	li: ["li"],
	option: ["option"],
	dt: ["dt", "dd"],
	dd: ["dt", "dd"],
	tr: ["tr"],
	td: ["td", "th"],
	th: ["td", "th"]
};

// 텍스트만 들어 있으면 한 줄로 모으는 태그 (<br> 이 있으면 <br> 기준으로 줄 분리)
const TEXT_LINE_TAGS = new Set([
	"span", "a", "b", "i", "u", "em", "strong", "label", "small", "big",
	"font", "sub", "sup", "code", "s", "strike", "abbr", "cite", "mark", "q",
	"p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "td", "th", "dt", "dd",
	"option", "title", "button", "legend", "caption"
]);

// JSP 스크립틀릿의 { 를 HTML 스택에 넣을 때 쓰는 표식
const JSP_BRACE = "%{";

// <br> 만 있는 줄 판별
const BR_ONLY = /^[ \t]*<br\s*\/?>[ \t]*$/i;

/* ------------------------------------------------------------------ */
/* line spec: 각 줄을 어떻게 출력할지 기술한다                            */
/*   b   : 공백만 있는 줄 -> 빈 줄                                       */
/*   raw : 원본 그대로                                                   */
/*   i   : 선행 whitespace를 d개의 TAB으로 교체                          */
/*   r   : 기준 줄(ref)에 대한 상대 들여쓰기를 유지하며 d 기준으로 이동   */
/* ------------------------------------------------------------------ */
const BLANK = { t: "b" };
const RAW = { t: "raw" };
const I = (d) => ({ t: "i", d: d });
const R = (d, ref) => ({ t: "r", d: d, ref: ref });

function isBlank(s) {
	return /^[ \t]*$/.test(s);
}

function leadOf(s) {
	return /^[ \t]*/.exec(s)[0];
}

function firstNonWs(s, from) {
	let p = from;
	while (p < s.length && (s[p] === " " || s[p] === "\t")) p++;
	return p;
}

function widthOf(ws) {
	let w = 0;
	for (const ch of ws) {
		w += ch === "\t" ? 4 - (w % 4) : 1;
	}
	return w;
}

function emitLine(line, spec) {
	if (!spec) return line;
	switch (spec.t) {
		case "b":
			return isBlank(line) ? "" : line;
		case "i":
			return TAB.repeat(spec.d) + line.replace(/^[ \t]+/, "");
		case "r": {
			const cur = leadOf(line);
			const content = line.slice(cur.length);
			if (content === "") return "";
			let rem;
			if (cur.startsWith(spec.ref)) {
				rem = cur.slice(spec.ref.length);
			} else {
				const extra = widthOf(cur) - widthOf(spec.ref);
				rem = extra > 0 ? TAB.repeat(Math.floor(extra / 4)) + " ".repeat(extra % 4) : "";
			}
			return TAB.repeat(spec.d) + rem + content;
		}
		default:
			return line;
	}
}

/* ------------------------------------------------------------------ */
/* 공통 스캔 유틸                                                       */
/* ------------------------------------------------------------------ */

// (l, c)부터 close 문자열을 찾아 close 직후 위치를 반환. 없으면 null
function skipTo(lines, l, c, close) {
	let cl = l;
	let cc = c;
	for (;;) {
		if (cl >= lines.length) return null;
		const idx = lines[cl].indexOf(close, cc);
		if (idx >= 0) return { l: cl, c: idx + close.length };
		cl++;
		cc = 0;
	}
}

// </name 위치 찾기
function findCloseTag(lines, l, c, name) {
	const re = new RegExp("</" + name + "(?=[\\s/>]|$)", "i");
	for (let k = l, from = c; k < lines.length; k++, from = 0) {
		const m = re.exec(lines[k].slice(from));
		if (m) return { l: k, c: from + m.index };
	}
	return null;
}

// ${...} / #{...} 를 같은 줄 안에서 건너뛴다. 닫히지 않으면 -1
function skipEl(line, c) {
	let depth = 0;
	let j = c + 1;
	while (j < line.length) {
		const ch = line[j];
		if (ch === '"' || ch === "'") {
			const q = ch;
			j++;
			while (j < line.length && line[j] !== q) {
				if (line[j] === "\\") j++;
				j++;
			}
			j++;
			continue;
		}
		if (ch === "{") {
			depth++;
		} else if (ch === "}") {
			depth--;
			if (depth === 0) return j + 1;
		}
		j++;
	}
	return -1;
}

function popTo(stack, name) {
	for (let k = stack.length - 1; k >= 0; k--) {
		if (stack[k] === name) {
			stack.length = k;
			return true;
		}
	}
	return false;
}

function popMatching(stack, closer) {
	const opener = closer === "}" ? "{" : closer === ")" ? "(" : "[";
	for (let k = stack.length - 1; k >= 0; k--) {
		if (stack[k].ch === opener) {
			stack.length = k;
			return;
		}
	}
}

// JSP 스크립틀릿(Java 코드) 안의 중괄호 균형 계산
//  pre  : 스크립틀릿 앞쪽에서 이미 열려 있던 블록을 닫는 } 개수
//  open : 스크립틀릿이 끝난 뒤에도 열려 있는 { 개수
function scanJavaBraces(code) {
	let pre = 0;
	let open = 0;
	let i = 0;
	while (i < code.length) {
		const ch = code[i];
		if (ch === '"' || ch === "'") {
			const q = ch;
			i++;
			while (i < code.length && code[i] !== q && code[i] !== "\n") {
				if (code[i] === "\\") i++;
				i++;
			}
			i++;
			continue;
		}
		if (ch === "/" && code[i + 1] === "/") {
			while (i < code.length && code[i] !== "\n") i++;
			continue;
		}
		if (ch === "/" && code[i + 1] === "*") {
			const e = code.indexOf("*/", i + 2);
			if (e < 0) break;
			i = e + 2;
			continue;
		}
		if (ch === "{") {
			open++;
		} else if (ch === "}") {
			if (open > 0) open--;
			else pre++;
		}
		i++;
	}
	return { pre: pre, open: open };
}

/* ------------------------------------------------------------------ */
/* 텍스트 전용 태그 한 줄 모으기                                         */
/*  <span>                                                             */
/*      텍스트                → <span>텍스트</span>                     */
/*  </span>                                                            */
/*  <br> 이 있으면 <br> 뒤에서 줄을 나눈다 (줄 수 = <br> 개수 + 1)         */
/*  내용에 다른 태그 / JSP 등이 있으면 아무것도 하지 않는다               */
/*  텍스트 내부의 연속 공백/탭은 공백 1개로 통일한다                      */
/* ------------------------------------------------------------------ */
function collapseTextTag(lines, specs, name, l, c) {
	const re = new RegExp("</" + name + "\\s*>", "i");
	const pieces = [];
	let endK = -1;

	for (let k = l; k < lines.length && k - l <= 30; k++) {
		let seg = k === l
			? lines[k].slice(c).replace(/^[ \t]+/, "").replace(/[ \t]+$/, "")
			: lines[k].replace(/^[ \t]+/, "").replace(/[ \t]+$/, "");
		const m = re.exec(seg);
		const content = m ? seg.slice(0, m.index) : seg;

		if (content.replace(/<br\s*\/?>/gi, "").indexOf("<") >= 0) return;

		// 텍스트 내부 연속 공백/탭 -> 공백 1개, 닫는 태그 앞 공백 제거
		const normalized = content.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+$/, "");
		seg = m ? normalized + seg.slice(m.index) : normalized;

		pieces.push(seg);
		if (m) {
			endK = k;
			break;
		}
	}

	if (endK < 0) return; // 닫는 태그를 못 찾음

	// 같은 줄에서 열고 닫는 경우 (<h2> Step2 </h2>)
	if (endK === l) {
		lines[l] = lines[l].slice(0, c) + pieces[0];
		return;
	}

	let acc = pieces[0];
	for (let i = 1; i < pieces.length; i++) {
		const p = pieces[i];
		if (p === "") continue;
		if (/<br\s*\/?>$/i.test(acc)) acc += "\n" + p;
		else if (acc === "" || p.startsWith("</")) acc += p;
		else acc += " " + p;
	}

	const parts = acc.split("\n");
	const newLines = [lines[l].slice(0, c) + parts[0]];
	for (let i = 1; i < parts.length; i++) newLines.push(parts[i]);

	const newSpecs = [specs[l]];
	for (let i = 1; i < newLines.length; i++) newSpecs.push(null);

	lines.splice(l, endK - l + 1, ...newLines);
	specs.splice(l, endK - l + 1, ...newSpecs);
}

/* ------------------------------------------------------------------ */
/* HTML 태그 스캔 (multiline, 따옴표 / JSP / EL 보호)                     */
/* ------------------------------------------------------------------ */
function scanTag(lines, l, c) {
	let cl = l;
	let cc = c + 1;
	let closing = false;
	if (lines[cl][cc] === "/") {
		closing = true;
		cc++;
	}
	const m = /^[A-Za-z][A-Za-z0-9:_.\-]*/.exec(lines[cl].slice(cc));
	if (!m) return null;
	const name = m[0];
	cc += name.length;

	let quote = null;
	let lastSig = "";
	const cont = [];

	for (;;) {
		const line = lines[cl];
		if (cc >= line.length) {
			cl++;
			if (cl >= lines.length) return null;
			cc = 0;
			const nl = lines[cl];
			if (quote) {
				cont.push({ line: cl, kind: "raw" });
			} else {
				const p = firstNonWs(nl, 0);
				if (p >= nl.length) {
					cont.push({ line: cl, kind: "blank" });
				} else {
					const isEnd = nl[p] === ">" || nl.startsWith("/>", p);
					cont.push({ line: cl, kind: isEnd ? "end" : "attr" });
				}
				cc = p;
			}
			continue;
		}

		const ch = line[cc];

		if (ch === "<" && line[cc + 1] === "%") {
			const close = line.startsWith("<%--", cc) ? "--%>" : "%>";
			const e = skipTo(lines, cl, cc + 2, close);
			if (!e) return null;
			for (let k = cl + 1; k <= e.l; k++) cont.push({ line: k, kind: "raw" });
			cl = e.l;
			cc = e.c;
			if (!quote) lastSig = ">";
			continue;
		}

		if ((ch === "$" || ch === "#") && line[cc + 1] === "{") {
			const e = skipEl(line, cc);
			if (e >= 0) {
				cc = e;
				if (!quote) lastSig = "}";
				continue;
			}
		}

		if (quote) {
			if (ch === quote) {
				quote = null;
				lastSig = ch;
			}
			cc++;
			continue;
		}

		if ((ch === '"' || ch === "'") && lastSig === "=") {
			quote = ch;
			cc++;
			continue;
		}

		if (ch === "<") return null; // 깨진 태그: 태그로 취급하지 않는다

		if (ch === ">") {
			return {
				name: name,
				closing: closing,
				endL: cl,
				endC: cc + 1,
				selfClose: lastSig === "/",
				cont: cont
			};
		}

		if (ch !== " " && ch !== "\t") lastSig = ch;
		cc++;
	}
}

function isTokenStart(line, j) {
	const ch = line[j];
	if (ch === "<") {
		const nx = line[j + 1] || "";
		if (nx === "!" || nx === "%") return true;
		if (/[A-Za-z]/.test(nx)) return true;
		if (nx === "/" && /[A-Za-z]/.test(line[j + 2] || "")) return true;
		return false;
	}
	if ((ch === "$" || ch === "#") && line[j + 1] === "{") {
		return skipEl(line, j) >= 0;
	}
	return false;
}

// 속성값 내부의 연속 공백을 1개로. ${...} / #{...} 내부는 건드리지 않고, <% 가 있으면 전체를 건드리지 않는다
function squeezeAttrValue(val) {
	if (val.indexOf("<%") >= 0) return val;
	let out = "";
	let i = 0;
	while (i < val.length) {
		const ch = val[i];
		if ((ch === "$" || ch === "#") && val[i + 1] === "{") {
			const e = skipEl(val, i);
			if (e < 0) return out + val.slice(i); // 닫히지 않은 EL: 나머지는 그대로
			out += val.slice(i, e);
			i = e;
			continue;
		}
		if (ch === " " || ch === "\t") {
			let j = i;
			while (j < val.length && (val[j] === " " || val[j] === "\t")) j++;
			out += j - i >= 2 ? " " : val.slice(i, j);
			i = j;
			continue;
		}
		out += ch;
		i++;
	}
	return out;
}

// 한 줄 안에서 class / id 속성값의 연속 공백을 1개로 (from~to 범위만 대상)
function squeezeClassId(line, from, to) {
	const head = line.slice(0, from);
	const seg = line.slice(from, to);
	const tail = line.slice(to);
	const re = /(?<![\w:\-])((?:class|id)\s*=\s*)(["'])((?:(?!\2).)*)\2/gi;
	const next = seg.replace(re, (m, pre, q, val) => pre + q + squeezeAttrValue(val) + q);
	return head + next + tail;
}

function isNonExecScript(tagText) {
	const m = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(tagText);
	if (!m) return false;
	return /html|template|handlebars|mustache|tmpl/i.test(m[1]);
}

/* ------------------------------------------------------------------ */
/* HTML formatter                                                      */
/*  - lines 배열은 <br> / 텍스트 태그 처리를 위해 제자리에서 수정될 수 있다 */
/*  - specs 배열을 반환한다                                             */
/*  - opts.brLines (Set) : <br> 만 있는 줄 번호를 기록한다               */
/* ------------------------------------------------------------------ */
function formatHtml(lines, base, opts) {
	const specs = new Array(lines.length).fill(null);
	const stack = [];
	const D = () => base + stack.length;
	const mark = (k, s) => {
		if (k >= 0 && k < specs.length && specs[k] === null) specs[k] = s;
	};
	const markRange = (from, to, d, ref) => {
		for (let k = from; k <= to && k < lines.length; k++) {
			mark(k, isBlank(lines[k]) ? BLANK : R(d, ref));
		}
	};

	// 여러 줄 블록(주석 / 스크립틀릿)의 내부 줄과 닫는 줄을 처리한다.
	//  - 내부 줄  : 시작 줄 depth + 1
	//  - 닫는 줄  : (닫는 토큰만 시작하는 줄이면) 시작 줄과 같은 depth
	//  - code=true 이면 내부를 JS/Java 스타일 중괄호 기준으로 들여쓴다
	const markBlock = (sL, eL, close, d, code) => {
		if (eL <= sL) return;
		const own = lines[eL].startsWith(close, firstNonWs(lines[eL], 0));
		const iEnd = own ? eL - 1 : eL;
		if (own) mark(eL, I(d));
		if (iEnd <= sL) return;

		if (code) {
			const sub = lines.slice(sL + 1, iEnd + 1);
			const ss = formatCode(sub, d + 1, "js");
			for (let k = 0; k < sub.length; k++) mark(sL + 1 + k, ss[k]);
		} else {
			let ref = null;
			for (let k = sL + 1; k <= iEnd; k++) {
				if (isBlank(lines[k])) continue;
				const ld = leadOf(lines[k]);
				if (ref === null || widthOf(ld) < widthOf(ref)) ref = ld;
			}
			if (ref === null) ref = "";
			for (let k = sL + 1; k <= iEnd; k++) {
				mark(k, isBlank(lines[k]) ? BLANK : R(d + 1, ref));
			}
		}
	};

	let l = 0;
	let c = 0;

	while (l < lines.length) {
		const line = lines[l];
		c = firstNonWs(line, c);
		if (c >= line.length) {
			if (specs[l] === null && isBlank(line)) specs[l] = BLANK;
			l++;
			c = 0;
			continue;
		}
		const ch = line[c];

		// ---- HTML 주석 ----
		if (line.startsWith("<!--", c)) {
			const d = D();
			mark(l, I(d));
			const end = skipTo(lines, l, c + 4, "-->");
			if (end) {
				markBlock(l, end.l, "-->", d, false);
				l = end.l;
				c = end.c;
			} else {
				markRange(l + 1, lines.length - 1, d + 1, leadOf(line));
				l = lines.length;
				c = 0;
			}
			continue;
		}

		// ---- <!DOCTYPE ...>, <![CDATA[ ... ]]> 등 ----
		if (line.startsWith("<!", c)) {
			const end = skipTo(lines, l, c + 2, ">");
			if (end) {
				mark(l, I(D()));
				markRange(l + 1, end.l, D(), leadOf(line));
				l = end.l;
				c = end.c;
				continue;
			}
		}

		// ---- JSP 주석 / 스크립틀릿 / 지시자 / 표현식 ----
		if (line.startsWith("<%", c)) {
			const isComment = line.startsWith("<%--", c);
			const close = isComment ? "--%>" : "%>";
			const end = skipTo(lines, l, c + (isComment ? 4 : 2), close);
			if (end) {
				const third = line[c + 2] || "";

				if (isComment) {
					// <%-- --%> : HTML 주석과 동일하게 처리
					const d = D();
					mark(l, I(d));
					markBlock(l, end.l, close, d, false);
				} else if (third === "@" || third === "=") {
					// <%@ 지시자 / <%= 표현식 : 불투명 블록
					const d = D();
					mark(l, I(d));
					markRange(l + 1, end.l, d, leadOf(line));
				} else {
					// <% ... %> / <%! ... %> : 태그처럼 취급
					let code = "";
					for (let k = l; k <= end.l; k++) {
						const from = k === l ? c + 2 : 0;
						const to = k === end.l ? end.c - 2 : undefined;
						code += lines[k].slice(from, to) + "\n";
					}
					const br = scanJavaBraces(code);

					// <% } %>, <% } else { %> : 앞선 <% ... { %> 를 닫는다
					for (let x = 0; x < br.pre; x++) {
						if (stack.length && stack[stack.length - 1] === JSP_BRACE) stack.pop();
						else break;
					}

					const d = D();
					mark(l, I(d));
					markBlock(l, end.l, close, d, true);

					// <% if (...) { %> : 이후 내용은 한 단계 더 들여쓴다
					for (let x = 0; x < br.open; x++) stack.push(JSP_BRACE);
				}

				l = end.l;
				c = end.c;
				continue;
			}
		}

		// ---- 태그 ----
		if (ch === "<" && /^<\/?[A-Za-z]/.test(line.slice(c, c + 3))) {
			const tag = scanTag(lines, l, c);
			if (tag) {
				const name = tag.name.toLowerCase();

				// class / id 속성값의 연속 공백을 1개로 (여는 태그, opts.split 일 때만)
				if (opts.split && !tag.closing) {
					for (let k = l; k <= tag.endL; k++) {
						const from = k === l ? c : 0;
						const to = k === tag.endL ? tag.endC : lines[k].length;
						const before = lines[k].length;
						lines[k] = squeezeClassId(lines[k], from, to);
						if (k === tag.endL) tag.endC += lines[k].length - before;
					}
				}

				let tagText = "";
				for (let k = l; k <= tag.endL; k++) {
					tagText += lines[k].slice(k === l ? c : 0, k === tag.endL ? tag.endC : undefined) + "\n";
				}

				if (tag.closing) {
					popTo(stack, name);
				} else if (
					AUTO_CLOSE[name] &&
					stack.length &&
					AUTO_CLOSE[name].indexOf(stack[stack.length - 1]) >= 0
				) {
					stack.pop();
				}

				const d = D();
				mark(l, I(d));
				for (const ct of tag.cont) {
					if (ct.kind === "raw") mark(ct.line, RAW);
					else if (ct.kind === "blank") mark(ct.line, BLANK);
					else if (ct.kind === "end") mark(ct.line, I(d));
					else mark(ct.line, I(d + 1));
				}

				const startL = l;
				l = tag.endL;
				c = tag.endC;

				if (!tag.closing) {
					if (VOID_TAGS.has(name) || tag.selfClose) {
						// <br> : 앞의 텍스트는 같은 줄에 두고, 뒤에 내용이 있으면 다음 줄로 이동
						if (name === "br" && opts.split) {
							const brIdx = l;
							const restStr = lines[l].slice(c);
							if (restStr.trim() !== "") {
								lines[l] = lines[l].slice(0, c);
								lines.splice(l + 1, 0, restStr.replace(/^[ \t]+/, ""));
								specs.splice(l + 1, 0, null);
								l++;
								c = 0;
							}
							// <br> 만 있는 줄이면 기록 (앞뒤 빈 줄 제거용)
							if (opts.brLines && BR_ONLY.test(lines[brIdx])) {
								opts.brLines.add(brIdx);
							}
						}
					} else {
						stack.push(name);

						// 텍스트만 든 태그는 한 줄로 모은다 (<br> 이 있으면 <br> 기준으로 줄 분리)
						if (opts.split && TEXT_LINE_TAGS.has(name) && tag.endL === startL) {
							collapseTextTag(lines, specs, name, l, c);
						}

						if (opts.raw && (name === "script" || name === "style")) {
							const close = findCloseTag(lines, l, c, name);
							const endL = close ? close.l : lines.length - 1;
							const endC = close ? close.c : lines[endL].length;
							const sub = [];
							for (let k = l; k <= endL; k++) {
								const from = k === l ? c : 0;
								const to = k === endL ? endC : lines[k].length;
								sub.push(lines[k].slice(from, to));
							}
							const cd = D();
							let subSpecs;
							if (name === "style") {
								subSpecs = formatCode(sub, cd, "css");
							} else if (isNonExecScript(tagText)) {
								subSpecs = rawRebase(sub, cd);
							} else {
								subSpecs = formatCode(sub, cd, "js");
							}
							for (let k = 1; k < sub.length; k++) {
								if (k === sub.length - 1 && close && isBlank(sub[k])) continue;
								mark(l + k, subSpecs[k]);
							}
							l = endL;
							c = endC;
						} else if (name === "pre" || name === "textarea") {
							const close = findCloseTag(lines, l, c, name);
							if (close) {
								for (let k = l + 1; k <= close.l; k++) mark(k, RAW);
								l = close.l;
								c = close.c;
							} else {
								for (let k = l + 1; k < lines.length; k++) mark(k, RAW);
								l = lines.length;
								c = 0;
							}
						}
					}
				}
				continue;
			}
		}

		// ---- ${...} / #{...} ----
		if ((ch === "$" || ch === "#") && line[c + 1] === "{") {
			const e = skipEl(line, c);
			if (e >= 0) {
				mark(l, I(D()));
				c = e;
				continue;
			}
		}

		// ---- 일반 텍스트 ----
		mark(l, I(D()));
		let j = c + 1;
		while (j < line.length && !isTokenStart(line, j)) j++;

		// 텍스트 구간 내부의 연속 공백을 1개로 통일 (opts.split 일 때만: 템플릿 마스킹 복사본 제외)
		if (opts.split) {
			const seg = line.slice(c, j);
			const squeezed = seg.replace(/ {2,}/g, " ");
			if (squeezed !== seg) {
				lines[l] = line.slice(0, c) + squeezed + line.slice(j);
				j = c + squeezed.length;
			}
		}
		c = j;
	}

	return specs;
}

/* ------------------------------------------------------------------ */
/* 상대 들여쓰기 유지 블록 (JSON 이외의 template script 등)               */
/* ------------------------------------------------------------------ */
function rawRebase(sub, d) {
	let ref = null;
	for (let k = 1; k < sub.length; k++) {
		if (!isBlank(sub[k])) {
			ref = leadOf(sub[k]);
			break;
		}
	}
	if (ref === null) ref = "";
	return sub.map((s, k) => {
		if (k === 0) return null;
		return isBlank(s) ? BLANK : R(d, ref);
	});
}

/* ------------------------------------------------------------------ */
/* JS / CSS 공통 indentation 스캐너                                     */
/*  - 괄호 스택 기반 (같은 줄에서 여러 개 열려도 한 단계만 증가)          */
/*  - 문자열, 주석, 정규식, template literal, JSP 블록 보호               */
/* ------------------------------------------------------------------ */
function scanString(src, specs, l, c) {
	const q = src[l][c];
	let jl = l;
	let j = c + 1;
	for (;;) {
		const s = src[jl];
		let esc = false;
		while (j < s.length) {
			const ch = s[j];
			if (ch === "\\") {
				if (j + 1 >= s.length) {
					esc = true;
					j++;
					break;
				}
				j += 2;
				continue;
			}
			if (ch === q) return { l: jl, c: j + 1 };
			j++;
		}
		if (esc && jl + 1 < src.length) {
			jl++;
			j = 0;
			if (specs && specs[jl] === null) specs[jl] = RAW;
			continue;
		}
		return { l: jl, c: s.length };
	}
}

function scanRegex(s, c) {
	let j = c + 1;
	let inClass = false;
	while (j < s.length) {
		const ch = s[j];
		if (ch === "\\") {
			j += 2;
			continue;
		}
		if (ch === "[") inClass = true;
		else if (ch === "]") inClass = false;
		else if (ch === "/" && !inClass) {
			j++;
			while (j < s.length && /[a-z]/i.test(s[j])) j++;
			return j;
		}
		j++;
	}
	return -1;
}

function regexAllowed(prevSig, prevWord) {
	if (prevSig === "a") {
		return /^(return|typeof|case|do|else|in|of|void|delete|throw|new|yield|await)$/.test(prevWord);
	}
	return prevSig === "" || "(,=:[!&|?{};+-*%<>~^".indexOf(prevSig) >= 0;
}

function scanExpr(src, l, c) {
	let depth = 1;
	let cl = l;
	let cc = c;
	for (;;) {
		if (cl >= src.length) return null;
		const s = src[cl];
		if (cc >= s.length) {
			cl++;
			cc = 0;
			continue;
		}
		const ch = s[cc];
		if (ch === '"' || ch === "'") {
			const e = scanString(src, null, cl, cc);
			cl = e.l;
			cc = e.c;
			continue;
		}
		if (ch === "`") {
			const t = scanTemplate(src, cl, cc);
			if (!t) return null;
			cl = t.l;
			cc = t.c;
			continue;
		}
		if (ch === "/" && s[cc + 1] === "/") {
			cc = s.length;
			continue;
		}
		if (ch === "/" && s[cc + 1] === "*") {
			const e = skipTo(src, cl, cc + 2, "*/");
			if (!e) return null;
			cl = e.l;
			cc = e.c;
			continue;
		}
		if (ch === "{") {
			depth++;
		} else if (ch === "}") {
			depth--;
			if (depth === 0) return { l: cl, c: cc + 1 };
		}
		cc++;
	}
}

// (l, c)는 여는 backtick 위치. 닫는 backtick 직후 위치와 ${...} 범위 목록을 반환
function scanTemplate(src, l, c) {
	let cl = l;
	let cc = c + 1;
	const exprs = [];
	for (;;) {
		if (cl >= src.length) return null;
		const s = src[cl];
		if (cc >= s.length) {
			cl++;
			cc = 0;
			continue;
		}
		const ch = s[cc];
		if (ch === "\\") {
			cc += 2;
			continue;
		}
		if (ch === "`") return { l: cl, c: cc + 1, exprs: exprs };
		if (ch === "$" && s[cc + 1] === "{") {
			const r = scanExpr(src, cl, cc + 2);
			if (!r) return null;
			exprs.push({ sl: cl, sc: cc, el: r.l, ec: r.c });
			cl = r.l;
			cc = r.c;
			continue;
		}
		cc++;
	}
}

function handleTemplate(src, specs, l, c, startIndent) {
	const t = scanTemplate(src, l, c);
	if (!t) return null;
	const n = t.l - l;
	if (n === 0) return { l: t.l, c: t.c };

	// ${...} 를 가린 정적 텍스트 생성
	const masked = [];
	for (let k = l; k <= t.l; k++) {
		const s = src[k];
		const from = k === l ? c + 1 : 0;
		const to = k === t.l ? t.c - 1 : s.length;
		const arr = s.slice(from, to).split("");
		for (const e of t.exprs) {
			if (k < e.sl || k > e.el) continue;
			const a = Math.max(0, (k === e.sl ? e.sc : 0) - from);
			const b = Math.min(arr.length, (k === e.el ? e.ec : s.length) - from);
			for (let x = a; x < b; x++) arr[x] = "x";
		}
		masked.push(arr.join(""));
	}

	const isHtml = /<\/?[A-Za-z][A-Za-z0-9:_.\-]*(?=[\s>\/]|$)/m.test(masked.join("\n"));

	if (!isHtml) {
		// HTML이 아니거나 깨진 형태: 아무것도 변경하지 않는다
		for (let k = l + 1; k <= t.l; k++) {
			if (specs[k] === null) specs[k] = RAW;
		}
		return { l: t.l, c: t.c };
	}

	const hs = formatHtml(masked, startIndent + 1, { split: false, raw: false });
	const finalDepth = [];

	for (let k = 1; k <= n; k++) {
		const abs = l + k;
		if (specs[abs] !== null) {
			finalDepth[k] = startIndent;
			continue;
		}
		let spec = null;
		let ex = null;
		for (const e of t.exprs) {
			if (e.sl < abs && abs <= e.el) {
				ex = e;
				break;
			}
		}
		if (ex) {
			// ${ ... } 내부에서 시작하는 줄: 시작 줄 기준 상대 들여쓰기 유지
			const rel = ex.sl - l;
			const d = rel === 0 || finalDepth[rel] === undefined ? startIndent : finalDepth[rel];
			spec = isBlank(src[abs]) ? BLANK : R(d, leadOf(src[ex.sl]));
		} else if (k === n && isBlank(masked[k])) {
			// 닫는 backtick만 있는 줄: 문장의 들여쓰기에 맞춘다
			spec = I(startIndent);
		} else {
			spec = hs[k];
		}
		specs[abs] = spec;
		finalDepth[k] = spec && typeof spec.d === "number" ? spec.d : startIndent;
	}

	return { l: t.l, c: t.c };
}

function formatCode(src, base, kind) {
	const isJs = kind === "js";
	const n = src.length;
	const specs = new Array(n).fill(null);
	const stack = [];

	const distinct = () => {
		const s = new Set();
		for (const e of stack) s.add(e.line);
		return s.size;
	};
	const specDepth = (k) => (specs[k] && typeof specs[k].d === "number" ? specs[k].d : base);
	const markInterior = (from, to, d, ref) => {
		for (let k = from; k <= to && k < n; k++) {
			if (specs[k] === null) specs[k] = isBlank(src[k]) ? BLANK : R(d, ref);
		}
	};

	let l = 0;
	let c = 0;
	let prevSig = "";
	let prevWord = "";

	while (l < n) {
		const line = src[l];

		if (specs[l] === null) {
			const p = firstNonWs(line, c);
			if (p >= line.length) {
				specs[l] = BLANK;
				l++;
				c = 0;
				continue;
			}
			let q = p;
			while (q < line.length && (line[q] === "}" || line[q] === "]" || line[q] === ")")) {
				popMatching(stack, line[q]);
				q++;
			}
			specs[l] = I(base + distinct());
			if (q > p) prevSig = line[q - 1];
			c = q;
		}

		if (c >= line.length) {
			l++;
			c = 0;
			continue;
		}

		const ch = line[c];

		if (ch === " " || ch === "\t") {
			c++;
			continue;
		}

		// JSP 블록 (<% %>, <%-- --%>) 은 불투명하게 처리
		if (ch === "<" && line[c + 1] === "%") {
			const close = line.startsWith("<%--", c) ? "--%>" : "%>";
			const e = skipTo(src, l, c + 2, close);
			const d = specDepth(l);
			const ref = leadOf(line);
			if (!e) {
				markInterior(l + 1, n - 1, d, ref);
				l = n;
				c = 0;
				continue;
			}
			markInterior(l + 1, e.l, d, ref);
			l = e.l;
			c = e.c;
			prevSig = "a";
			prevWord = "";
			continue;
		}

		// 한 줄 주석 (JS)
		if (isJs && ch === "/" && line[c + 1] === "/") {
			c = line.length;
			continue;
		}

		// 블록 주석 (JS / CSS)
		if (ch === "/" && line[c + 1] === "*") {
			const e = skipTo(src, l, c + 2, "*/");
			const d = specDepth(l);
			const ref = leadOf(line);
			if (!e) {
				markInterior(l + 1, n - 1, d, ref);
				l = n;
				c = 0;
				continue;
			}
			markInterior(l + 1, e.l, d, ref);
			l = e.l;
			c = e.c;
			continue;
		}

		// 문자열
		if (ch === '"' || ch === "'") {
			const e = scanString(src, specs, l, c);
			l = e.l;
			c = e.c;
			prevSig = "a";
			prevWord = "";
			continue;
		}

		// template literal (JS)
		if (isJs && ch === "`") {
			const r = handleTemplate(src, specs, l, c, specDepth(l));
			if (r) {
				l = r.l;
				c = r.c;
				prevSig = "a";
				prevWord = "";
				continue;
			}
			c++;
			continue;
		}

		// 정규식 literal (JS)
		if (isJs && ch === "/" && regexAllowed(prevSig, prevWord)) {
			const e = scanRegex(line, c);
			if (e >= 0) {
				c = e;
				prevSig = "a";
				prevWord = "";
				continue;
			}
		}

		if (ch === "{" || ch === "[" || ch === "(") {
			stack.push({ ch: ch, line: l });
			prevSig = ch;
			prevWord = "";
			c++;
			continue;
		}

		if (ch === "}" || ch === "]" || ch === ")") {
			popMatching(stack, ch);
			prevSig = ch;
			prevWord = "";
			c++;
			continue;
		}

		if (/[A-Za-z0-9_$]/.test(ch)) {
			let j = c + 1;
			while (j < line.length && /[A-Za-z0-9_$]/.test(line[j])) j++;
			prevWord = line.slice(c, j);
			prevSig = "a";
			c = j;
			continue;
		}

		prevSig = ch;
		prevWord = "";
		c++;
	}

	return specs;
}

/* ------------------------------------------------------------------ */
/* 문서 전체 포맷                                                       */
/* ------------------------------------------------------------------ */
function stripAllWhitespace(s) {
	return s.replace(/\s+/g, "");
}

function formatText(text) {
	const eol = text.indexOf("\r\n") >= 0 ? "\r\n" : "\n";
	const lines = text.split(/\r?\n/);
	const brLines = new Set();
	const specs = formatHtml(lines, 0, { split: true, raw: true, brLines: brLines });

	const out = new Array(lines.length);
	for (let i = 0; i < lines.length; i++) {
		out[i] = emitLine(lines[i], specs[i]);
	}

	// <br> 만 있는 줄의 앞뒤 빈 줄 제거
	const drop = new Array(out.length).fill(false);
	brLines.forEach((i) => {
		for (let k = i - 1; k >= 0 && isBlank(out[k]); k--) drop[k] = true;
		for (let k = i + 1; k < out.length - 1 && isBlank(out[k]); k++) drop[k] = true;
	});
	const kept = [];
	for (let i = 0; i < out.length; i++) {
		if (!drop[i]) kept.push(out[i]);
	}

	const result = kept.join(eol);

	// 안전장치: 공백 이외의 내용이 하나라도 달라지면 원본을 그대로 반환
	if (stripAllWhitespace(result) !== stripAllWhitespace(text)) {
		return text;
	}
	return result;
}

function formatDocument(document) {
	const text = document.getText();
	let formatted;
	try {
		formatted = formatText(text);
	} catch (err) {
		console.error("[jspTab4Formatter] format failed:", err);
		return [];
	}
	if (formatted === text) return [];
	const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(text.length));
	return [vscode.TextEdit.replace(fullRange, formatted)];
}

/* ------------------------------------------------------------------ */
/* VS Code 확장                                                        */
/* ------------------------------------------------------------------ */
function isTarget(document) {
	if (!document) return false;
	const id = document.languageId;
	return id === "html" || id === "jsp" || /\.jsp$/i.test(document.fileName);
}

function applyTabOptions(editor) {
	if (!editor || !isTarget(editor.document)) return;
	const o = editor.options;
	if (o.tabSize === 4 && o.insertSpaces === false) return;
	editor.options = {
		tabSize: 4,
		insertSpaces: false
	};
}

function activate(context) {
	const selector = [
		{ language: "html" },
		{ language: "jsp" },
		{ pattern: "**/*.jsp" }
	];

	// 이미 열려 있는 에디터에 적용
	vscode.window.visibleTextEditors.forEach(applyTabOptions);

	// 파일을 열거나 탭을 전환할 때마다 탭 크기 4로 고정
	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(applyTabOptions),
		vscode.window.onDidChangeVisibleTextEditors((editors) => editors.forEach(applyTabOptions)),
		vscode.workspace.onDidOpenTextDocument((doc) => {
			vscode.window.visibleTextEditors
				.filter((e) => e.document === doc)
				.forEach(applyTabOptions);
		})
	);

	context.subscriptions.push(
		vscode.languages.registerDocumentFormattingEditProvider(selector, {
			provideDocumentFormattingEdits(document) {
				return formatDocument(document);
			}
		})
	);

	// command title: "Format JSP with TAB4"
	context.subscriptions.push(
		vscode.commands.registerCommand(COMMAND_ID, async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) return;
			applyTabOptions(editor);
			const edits = formatDocument(editor.document);
			if (!edits.length) return;
			await editor.edit((builder) => {
				for (const e of edits) {
					builder.replace(e.range, e.newText);
				}
			});
		})
	);
}

function deactivate() {}

module.exports = {
	activate,
	deactivate
};