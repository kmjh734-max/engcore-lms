import fitz, json, re, sys

plan = json.load(open(sys.argv[1], encoding='utf8'))
for b in plan:
    f = fitz.open(b['front'])
    out = fitz.open()
    n = len(f)
    assert n == 2 + len(b['lessons']), (b['out'], n)
    out.insert_pdf(f, from_page=0, to_page=1)
    for i, L in enumerate(b['lessons']):
        out.insert_pdf(f, from_page=2 + i, to_page=2 + i)
        out.insert_pdf(fitz.open(L['file']), from_page=L['from'] - 1, to_page=L['to'] - 1)
    # 과마다 따로 찍은 PDF를 합치면 한글 글꼴이 겹쳐 실려 무겁다(5.9MB) — 글꼴을 다시 줄여 담는다(3.7MB, 글자 PDF 그대로)
    out.subset_fonts()
    out.save(b['out'], garbage=4, deflate=True, deflate_fonts=True, clean=True)
    # 쪽 번호 대조: 찍힌 번호가 실제 쪽과 같은지
    bad = []
    for i, p in enumerate(out):
        nums = re.findall(r'^- (\d+) -$', p.get_text(), re.M)
        if nums and int(nums[-1]) != i + 1:
            bad.append((i + 1, nums[-1]))
    print(b['out'].split('/')[-1].split('\\')[-1], len(out), '예상', b['total'], '번호 어긋남', bad[:5], f"{round(len(out.tobytes(garbage=0))/1e6)}MB" if False else '')
