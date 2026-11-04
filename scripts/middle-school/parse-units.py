# 중학교 족보닷컴 한글 자료(dump-hwp.py 글자 파일) → 과마다 단어·문법·대화문·본문 JSON
#   python -X utf8 scripts/middle-school/parse-units.py <덤프 폴더> scripts/middle-school/units.json
#
# 본문 나눔은 내용정리 플러스의 본문❶❷… 「Sentence Study 문장 학습」 기준(고등과 같음, textbook-split-by-plus).
# 대화문은 내용정리 플러스 앞쪽(표현 점검 전)의 해설 대화 + 우리말 해석을 순서대로 짝짓는다.
import sys, os, re, json, glob

SRC, OUT = sys.argv[1], sys.argv[2]
KO = re.compile(r"[가-힣]")
CIRCLED = "❶❷❸❹❺❻❼❽❾❿"
NUM_LINE = re.compile(r"^\s*\d{1,2}\s*$")
POS = r"(?:n|v|a|adj|adv|prep|conj|pron|int|interj|aux)\."


def lines_of(path):
    if not os.path.exists(path):
        return []
    return [l.rstrip() for l in open(path, encoding="utf8").read().split("\n")]


def clean(s):
    s = s.replace("\u00a0", " ").replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    s = re.sub(r"[\uf000-\uf8ff\U000f0000-\U000fffff]", "", s)  # 한글 글꼴 기호(사용자 영역)
    return re.sub(r"\s+", " ", s).strip()


# ── 단어 ────────────────────────────────────────────────
WORD_LINE = re.compile(r"^(?P<en>[A-Za-z0-9'’/~().,\- ]+?)\s*(?:\t+|\s{2,}|\s(?=" + POS + r")|\s(?=[가-힣(]))(?P<rest>.+)$")


def parse_words(ls):
    out, section, mode = [], None, None
    examples = {}
    cur = None
    for raw in ls:
        line = raw.strip()
        if not line:
            continue
        if line.startswith("교과서 어휘 목록"):
            mode = "list"
            continue
        if line.startswith("필수 단어 영영"):
            mode = "done"
            continue
        if line.startswith("필수 단어"):
            mode = "ex"
            continue
        m = re.match(r"^(CONVERSATION|READING|COMMUNICATION|DIALOGUE|LISTENING)\b.*│\s*(\S+)", line)
        if m:
            section = "본문" if m.group(1) == "READING" else "대화문"
            if mode == "ex" and section == "본문" and out and examples.get("__seen_reading"):
                mode = "done"
            if mode == "ex" and section == "본문":
                examples["__seen_reading"] = True
            continue
        if mode == "list":
            if NUM_LINE.match(line) or line.startswith(("2022 개정", "WORD TEST", "중1", "중2")):
                continue
            if cur and re.match(POS + r"\s", line):
                cur["meaning"] += "; " + clean(line)  # 둘째 뜻(a. 가장 좋아하는)
                continue
            wm = WORD_LINE.match(raw.replace("\u00a0", " ").strip())
            if wm and re.match(r"^[A-Za-z0-9'’~]", wm.group("en")) and (re.match(POS, wm.group("rest")) or KO.search(wm.group("rest")[:6])):
                cur = {"section": section, "word": clean(wm.group("en")), "meaning": clean(wm.group("rest"))}
                out.append(cur)
            elif cur and (re.match(POS, line) or KO.search(line[:4]) or line.startswith("(")):
                cur["meaning"] += " " + clean(line)
        elif mode == "ex":
            # 「영어 예문. 우리말.」 한 줄 — 바로 앞 낱말의 예문
            if re.match(r"^[A-Z\"'(]", line) and KO.search(line) and re.search(r"[.!?]\s", line):
                m2 = re.match(r"^(.*?[.!?\"])\s+([^A-Za-z].*)$", line)
                if m2 and cur is not None and examples.get("__last"):
                    examples.setdefault(examples["__last"], []).append({"en": clean(m2.group(1)), "ko": clean(m2.group(2))})
            else:
                wm = WORD_LINE.match(raw.replace("\u00a0", " ").strip())
                if wm and re.match(r"^[a-z0-9'’~]", wm.group("en")):
                    examples["__last"] = clean(wm.group("en"))
    for w in out:
        ex = examples.get(w["word"])
        if ex:
            w["examples"] = ex[:2]
        w["meaning"] = re.sub(r"\s*;\s*$", "", re.sub(r";\s*;", ";", w["meaning"]))
    # 예문 줄이 낱말로 잘못 잡힌 것(여섯 낱말 넘고 마침표로 끝남)은 버린다
    out = [w for w in out if not (len(w["word"].split()) > 5 and re.search(r"[.!?]$", w["word"]))]
    # 같은 섹션에 같은 낱말이 두 번(bake 등) 나오면 하나만
    seen, uniq = set(), []
    for w in out:
        k = (w["section"], w["word"].lower())
        if k in seen:
            continue
        seen.add(k)
        uniq.append(w)
    return uniq


# ── 문법 ────────────────────────────────────────────────
def parse_grammar(ls):
    pats, cur, mode = [], None, None
    i = 0
    while i < len(ls):
        line = ls[i].strip()
        # 「│Pattern 1, 2│ 비교급, 최상급」처럼 두 패턴을 한 머리글로 묶은 과가 있다(중1 동아(윤) 5·7과, 중2 동아(이) 5과) — 첫 번호로 하나
        m = re.match(r"^│Pattern (\d)(?:\s*,\s*\d)*│$", line)
        if m:
            title = ""
            j = i + 1
            while j < len(ls) and not ls[j].strip():
                j += 1
            title = clean(ls[j]) if j < len(ls) else ""
            if any(p["no"] == int(m.group(1)) for p in pats):
                cur = None
                i = j + 1
                continue
            cur = {"no": int(m.group(1)), "title": title, "points": [], "examples": []}
            pats.append(cur)
            mode = "points"
            i = j + 1
            continue
        if cur is not None:
            if line.startswith("▼ 교과서 예문"):
                mode = "ex"
            elif line.startswith(("▌", "Use It", "Play Time", "Grammar Point", "Warm-up", "❙정답❙")):
                mode = None
            elif mode == "points" and line.startswith("•"):
                cur["points"].append(clean(line.lstrip("• ")))
            elif mode == "points" and line.startswith("e.g.") and cur["points"]:
                cur["points"][-1] += " | " + clean(line[4:])
            elif mode == "points" and cur["points"] and re.match(r"^[A-Z]", line) and not KO.search(line[:3]) and cur["points"][-1].find(" | ") >= 0:
                cur["points"][-1] += " / " + clean(line)
            elif mode == "ex":
                if line.startswith("•"):
                    t = clean(line.lstrip("• "))
                    m2 = re.match(r"^(.*?[.!?])\s+([^A-Za-z].*)$", t)
                    cur["examples"].append({"en": m2.group(1) if m2 else t, "ko": m2.group(2) if m2 else "", "fromText": False})
                elif line == "교과서 본문" and cur["examples"]:
                    cur["examples"][-1]["fromText"] = True
        i += 1
    return pats


# ── 본문 ────────────────────────────────────────────────
SENT = re.compile(r"(?<=[.!?])[\"']?\s+(?=[\"']?[A-Z0-9])")
SENT_KO = re.compile(r"(?<=[.!?])[\"']?\s+")


def norm(s):
    return re.sub(r"[^a-z0-9]", "", clean(s).lower())


HEADER = re.compile(r"^(2022 개정.*|\d+|중[123]|교과서 본문|동아\(.*\)|Special.*)$")


def ko_heavy(l):
    return bool(KO.search(l))


def read_body(ls):
    """본문.hwp: 쪽마다 영어 문단들 → 같은 차례의 우리말 문단들이 되풀이된다. [(영어 줄들, 우리말 줄들)]"""
    body = [clean(l) for l in ls if clean(l)]
    body = [l for l in body if not re.search(r"저작권|라이센스|콘텐츠", l) and not HEADER.match(l)]
    blocks = []
    for idx, l in enumerate(body):
        k = ko_heavy(l)
        if blocks and not k and blocks[-1][1] and is_label(l):
            # 우리말 쪽의 이름 줄(Bella, Miguel)인지, 다음 쪽 영어 덩어리의 소제목(APR 22)인지는 다음 글줄로 가른다
            nxt = next((x for x in body[idx + 1:] if not is_label(x)), "")
            if ko_heavy(nxt):
                blocks[-1][1].append(l)
                continue
        if not blocks or (not k and blocks[-1][1]):
            blocks.append(([], []))
        (blocks[-1][1] if k else blocks[-1][0]).append(l)
    return blocks


ABBR = re.compile(r"\b(Mt|Mr|Mrs|Ms|Dr|St|Jr|vs|etc|No|a\.m|p\.m)\.$")


def align(en, ko):
    """문장 수가 다를 때: 길이로 1:1 · 1:2 · 2:1 짝을 찾는다(우리말 쪽을 붙이거나 영어 둘에 한 해석)."""
    import math
    n, m = len(en), len(ko)
    if not n or not m:
        return [""] * n
    le = [max(1, len(x)) for x in en]
    lk = [max(1, len(x)) * 1.9 for x in ko]  # 우리말이 영어보다 글자 수가 적다
    INF = 1e18
    cost = [[INF] * (m + 1) for _ in range(n + 1)]
    back = [[None] * (m + 1) for _ in range(n + 1)]
    cost[0][0] = 0
    moves = ((1, 1, 0), (1, 2, 1.5), (2, 1, 1.5), (1, 0, 4), (0, 1, 4))
    for i in range(n + 1):
        for j in range(m + 1):
            if cost[i][j] >= INF:
                continue
            for di, dj, pen in moves:
                ni, nj = i + di, j + dj
                if ni > n or nj > m:
                    continue
                a = sum(le[i:ni]) if di else 1
                b = sum(lk[j:nj]) if dj else 1
                c = cost[i][j] + pen + (abs(math.log(a / b)) if di and dj else 0)
                if c < cost[ni][nj]:
                    cost[ni][nj] = c
                    back[ni][nj] = (i, j)
    out = [""] * n
    i, j = n, m
    while (i, j) != (0, 0):
        pi, pj = back[i][j]
        if i - pi >= 1 and j - pj >= 1:
            out[pi] = " ".join(ko[pj:j])  # 영어 둘에 해석 하나면 앞 문장에 싣는다
        i, j = pi, pj
    return out


def is_label(s):
    # 이름표 줄(Bella, Show Host, Carlos Diaz, a janitor, Jan. 5 …) — 짧고 문장 끝 부호가 없다
    return len(s.split()) <= 8 and not re.search(r"[.!?\"')]$", s)


def plus_anchors(ls):
    """내용정리 플러스 문장 학습의 본문 ❶❷… 덩어리마다 첫 영어 문장 앞머리."""
    titles, anchors = {}, []
    stop = next((k for k, l in enumerate(ls) if "본문│내용 점검" in l), len(ls))
    for k, l in enumerate(ls[:stop]):
        s = l.strip()
        m = re.match(r"^본문 ([" + CIRCLED + r"])\s*(\S.*)?$", s)
        if not m:
            continue
        if m.group(2):
            titles.setdefault(m.group(1), clean(m.group(2)))
            continue
        if any(a[0] == m.group(1) for a in anchors):
            continue
        for x in ls[k + 1:k + 12]:
            t = clean(x)
            if not t or KO.search(t) or NUM_LINE.match(x) or t.startswith(("READING", "Sentence Study", "2022")) or "┃" in t:
                continue
            if len(t.split()) < 2 and not re.search(r"[.!?]$", t):
                continue  # 말하는 사람 이름
            anchors.append((m.group(1), " ".join(t.split()[:6])))
            break
    return titles, anchors


def parse_passages(body_ls, plus_ls, tag=""):
    blocks = read_body(body_ls)
    if not blocks or not blocks[0][0]:
        return []
    title_en, title_ko = blocks[0][0][0], (blocks[0][1][0] if blocks[0][1] else "")
    blocks[0] = (blocks[0][0][1:], blocks[0][1][1:])
    titles, anchors = plus_anchors(plus_ls)
    # 문단 → 문장(말하는 사람 이름 줄은 다음 문장에 붙인다)
    # 덩어리마다: 문단 수가 같으면 문단끼리, 아니면 덩어리 전체 문장 수가 같을 때 문장끼리 짝짓는다
    def split_en(p):
        out = []
        for x in (x.strip() for x in SENT.split(p)):
            if not x:
                continue
            if out and ABBR.search(out[-1]):
                out[-1] += " " + x
            else:
                out.append(x)
        return out

    def split_ko(p):
        return [x.strip() for x in SENT_KO.split(p) if x.strip()]

    sents = []  # {en, ko, speaker}
    for en_b, ko_b in blocks:
        en_items = []  # (speaker, 문장들, 문단 번호)
        speaker = ""
        for p in en_b:
            if is_label(p):
                speaker = (speaker + " " + p).strip()
                continue
            en_items.append((speaker, split_en(p)))
            speaker = ""
        ko_paras = [k for k in ko_b if not (len(k) <= 30 and not re.search(r"[.!?\"')]$", k))]
        # 문단을 넘어 「from Mrs. / Granger.」로 잘린 것은 앞 문단에 붙인다
        fixed = []
        for sp, es in en_items:
            if fixed and fixed[-1][1] and ABBR.search(fixed[-1][1][-1]) and es:
                fixed[-1][1][-1] += " " + es[0]
                es = es[1:]
                if not es:
                    continue
            fixed.append((sp, es))
        en_items = fixed
        flat_en = [e for _, es in en_items for e in es]
        flat_ko = [k for kp in ko_paras for k in split_ko(kp)]
        if len(flat_en) == len(flat_ko):
            kos = flat_ko
        elif len(en_items) == len(ko_paras) and all(len(split_ko(kp)) == len(es) for (_, es), kp in zip(en_items, ko_paras)):
            kos = [k for kp in ko_paras for k in split_ko(kp)]
        else:
            kos = align(flat_en, flat_ko)
        n = 0
        for sp, es in en_items:
            for j, e in enumerate(es):
                sents.append({"en": e, "ko": kos[n], "speaker": sp if j == 0 else ""})
                n += 1
    # Mt. · Mrs. 같은 줄임말 뒤에서 잘린 문장은 다시 붙인다
    merged = []
    for s in sents:
        if merged and re.search(r"\b(Mt|Mr|Mrs|Ms|Dr|St|Jr|vs|etc|No)\.$", merged[-1]["en"]):
            merged[-1]["en"] += " " + s["en"]
            merged[-1]["ko"] = (merged[-1]["ko"] + " " + s["ko"]).strip()
        else:
            merged.append(s)
    sents = merged
    # 자를 자리: 소제목(말하는 사람·날짜 줄)까지 이어 붙인 글에서 앞머리를 찾아, 그 자리가 든 문장
    keys = [norm(s["speaker"]) + norm(s["en"]) for s in sents]
    starts, pos = [], 0
    for k in keys:
        starts.append(pos)
        pos += len(k)
    flat = "".join(keys)
    cuts, after = [], 0
    for mark, head in anchors:
        h = norm(re.sub(r"^\d+\.\s*", "", head))[:24]
        at = flat.find(h, after) if len(h) >= 4 else -1
        if at < 0 and len(h) >= 4:
            at = flat.find(h)
        if at < 0 and len(h) >= 6:
            # 소제목 뒤에 붙은 [D-14] 같은 꼬리표는 본문 파일에 없을 수 있다 — 앞 낱말 둘로 다시
            h2 = norm(" ".join(re.sub(r"^\d+\.\s*", "", head).split()[:2]))
            at = flat.find(h2, after) if len(h2) >= 5 else -1
        hit = None
        if at >= 0:
            hit = max(i for i, st in enumerate(starts) if st <= at)
            after = at + 1
        cuts.append((mark, hit))
    good = [(m, i) for m, i in cuts if i is not None]
    if not good or good[0][1] != 0:
        good = [("❶", 0)] + [g for g in good if g[1] != 0]
    good.sort(key=lambda g: g[1])
    missed = [m for m, i in cuts if i is None]
    parts = []
    for idx, (mark, start) in enumerate(good):
        end = good[idx + 1][1] if idx + 1 < len(good) else len(sents)
        parts.append({
            "part": f"본문{idx + 1}",
            "mark": mark,
            "title": titles.get(mark, ""),
            "sentences": sents[start:end],
        })
    if parts:
        parts[0]["passageTitle"] = {"en": title_en, "ko": title_ko}
    if missed:
        print("   못 찾은 자리", tag, missed, [a for a in anchors if a[0] in missed])
    return parts


# ── 대화문 ──────────────────────────────────────────────
TURN_EN = re.compile(r"^(?P<sp>[A-Z][A-Za-z.]{0,10}\d?|[A-Z]\d?)\s*:\s*(?P<t>[^가-힣]+)$")
TURN_KO = re.compile(r"^(?P<sp>[가-힣A-Za-z]{1,6}\d?)\s*:\s*(?P<t>.*[가-힣].*)$")
SECTION = re.compile(r"^([A-Z])\.\s+(\S.*)$")
STRUCT = re.compile(r"^(•|▌|◗|┃|□|\[|TIP|Expressions|COMMUNICATION|DIALOGUE|Communication|대화문│|의사소통|\d+\.\s|[A-Z]\.\s|Watch|Listen|Talk|Script)")


def parse_dialogues(ls):
    end = len(ls)
    for k, l in enumerate(ls):
        if "표현 점검" in l:
            end = k
            break
    region = ls[:end]
    en_groups, ko_groups = [], []
    section = ""
    cur_en = cur_ko = None
    for raw in region:
        s = raw.strip()
        if not s:
            continue
        sm = SECTION.match(s)
        if sm and not KO.search(s):
            section = clean(s)
            cur_en = cur_ko = None
            continue
        if re.match(r"^\d\.\s*$", s):
            cur_en = cur_ko = None
            continue
        lead = re.match(r"^\d\.\s+(\S.*)$", s)
        if lead and (TURN_EN.match(lead.group(1)) or TURN_KO.match(lead.group(1))):
            # 「1. G: …」 번호가 첫 말차례와 한 줄에 있다
            cur_en = cur_ko = None
            s = lead.group(1)
            raw = s
        if raw[:1] != " " and TURN_EN.match(s) and "↳" not in s and "↲" not in s:
            if cur_en is None:
                cur_en = {"section": section, "turns": []}
                en_groups.append(cur_en)
            mm = TURN_EN.match(s)
            cur_en["turns"].append({"speaker": mm.group("sp"), "en": clean(mm.group("t"))})
            continue
        if TURN_KO.match(s) and not s.startswith(("A:", "B:")) or (TURN_KO.match(s) and section):
            mm = TURN_KO.match(s)
            if mm and not re.match(r"^[A-Za-z ]+$", mm.group("t")):
                if cur_ko is None:
                    cur_ko = {"section": section, "turns": []}
                    ko_groups.append(cur_ko)
                cur_ko["turns"].append(clean(mm.group("t")))
                continue
        if STRUCT.match(s) or (cur_en and TURN_KO.match(s)):
            # 소제목·안내·문제 줄이 오면 대화 덩어리가 끝난다(‘~할 필요가 있다’ 같은 해설 줄은 건너뛴다)
            cur_en = None
            if not TURN_KO.match(s):
                cur_ko = None
    # 단원 첫머리 「의사소통 기능」 예시(A:/B: 두 줄)는 대화문이 아니다
    # 빈칸을 뚫은 연습용 대화(문자 메시지 채우기 등)도 뺀다
    # 「Goal: to stop …」 같은 포스터 줄은 말차례가 아니다(말 첫 글자가 소문자)
    for g in en_groups:
        g["turns"] = [t for t in g["turns"] if not re.match(r"^[a-z]", t["en"])]
    # 혼자 길게 말하는 안내 방송(Listen Up 등)은 한 말차례여도 받는다
    def real(g, long_en):
        return len(g["turns"]) >= 3 or (len(g["turns"]) == 1 and long_en(g["turns"][0]))
    en_groups = [g for g in en_groups if g["section"] and not any("__" in t["en"] for t in g["turns"])
                 and real(g, lambda t: len(t["en"].split()) >= 25)]
    ko_groups = [g for g in ko_groups if real(g, lambda t: len(t) >= 40)]
    # 같은 대화가 두 번(원문·연습) 나오면 첫 번만
    seen, uniq = set(), []
    for g in en_groups:
        key = " ".join(t["en"] for t in g["turns"])[:120]
        if key in seen:
            continue
        seen.add(key)
        uniq.append(g)
    # 해석은 말차례 수가 같은 덩어리 가운데 이름·숫자가 가장 많이 겹치는 것과 짝짓는다
    # (차례로만 짝지으면 하나가 빠질 때 뒤가 모두 한 칸씩 밀린다)
    def marks(text):
        return set(re.findall(r"[A-Z][a-z]{2,}|\d+", text)) - {"The", "This", "That", "What", "How", "Yes", "Not", "Let", "Then", "Thanks", "Thank", "Really", "Sounds", "Good", "Hello", "Sure", "Wow", "Look", "Well", "Why", "Can", "Are", "You", "Did", "Does", "Don", "Excuse", "Perfect", "Great", "Okay", "Sorry", "Here", "There", "They", "When", "Where", "Which", "Who", "Will", "Oh", "Hmm", "Mom", "Dad"}

    used = set()
    for g in uniq:
        en_text = " ".join(t["en"] for t in g["turns"])
        em = marks(en_text)
        best, best_score = None, -1
        for kidx, kg in enumerate(ko_groups):
            if kidx in used or len(kg["turns"]) != len(g["turns"]):
                continue
            ko_text = " ".join(kg["turns"])
            score = sum(1 for m in em if m in ko_text)
            if score > best_score:
                best, best_score = kidx, score
        # 이름·숫자가 있는데 하나도 안 겹치면 다른 대화의 해석이다 — 붙이지 않는다
        if best is None or (em and best_score == 0 and any(m in " ".join(" ".join(k["turns"]) for k in ko_groups) for m in em)):
            continue
        used.add(best)
        for t, ko in zip(g["turns"], ko_groups[best]["turns"]):
            t["ko"] = ko
    for idx, g in enumerate(uniq):
        g["part"] = f"대화문{idx + 1}"
    return uniq


def unit_title(ls):
    for k, l in enumerate(ls[:12]):
        if l.strip().startswith("Lesson"):
            for x in ls[k + 1:k + 4]:
                if x.strip():
                    return clean(x)
    return ""


units = []
for d in sorted(glob.glob(os.path.join(SRC, "*", "*", "*"))):
    grade, pub, lesson = d.replace("\\", "/").split("/")[-3:]
    plus = lines_of(os.path.join(d, "플러스.txt"))
    u = {
        "grade": grade,
        "publisher": pub,
        "lesson": lesson,
        "title": unit_title(plus),
        "words": parse_words(lines_of(os.path.join(d, "단어.txt"))),
        "grammar": parse_grammar(lines_of(os.path.join(d, "문법.txt"))),
        "dialogues": parse_dialogues(plus),
        "passages": parse_passages(lines_of(os.path.join(d, "본문.txt")), plus, f"{grade} {pub} {lesson}"),
    }
    units.append(u)
    ks = sum(1 for g in u["dialogues"] for t in g["turns"] if t.get("ko"))
    kt = sum(len(g["turns"]) for g in u["dialogues"])
    print(f"{grade} {pub} {lesson} 「{u['title']}」 단어 {len(u['words'])} · 문법 {[g['title'] for g in u['grammar']]} · "
          f"대화 {len(u['dialogues'])}({ks}/{kt} 해석) · 본문 {[len(p["sentences"]) for p in u["passages"]]}")

json.dump(units, open(OUT, "w", encoding="utf8"), ensure_ascii=False, indent=1)
