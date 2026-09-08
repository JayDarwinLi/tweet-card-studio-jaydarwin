from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from datetime import datetime
from pathlib import Path

from pypdf import PdfReader


TOPICS: list[tuple[str, list[str]]] = [
    ("自媒体与个人IP", ["自媒体", "个人ip", "ip", "内容", "选题", "创作", "创作者", "粉丝", "流量", "账号", "小红书", "抖音", "公众号", "直播", "视频", "写作"]),
    ("商业与赚钱", ["商业", "生意", "赚钱", "收入", "变现", "客户", "销售", "产品", "创业", "定价", "付费", "消费", "市场", "利润", "企业", "经营"]),
    ("AI与科技", ["ai", "人工智能", "chatgpt", "大模型", "模型", "算法", "科技", "互联网", "软件", "工具", "编程", "数字化"]),
    ("投资与理财", ["投资", "股票", "基金", "房产", "资产", "现金流", "理财", "财富", "股市", "收益", "亏损", "复利", "资本"]),
    ("职场与工作", ["职场", "工作", "老板", "同事", "面试", "上班", "员工", "管理", "领导", "辞职", "职业", "公司"]),
    ("学习与认知", ["学习", "读书", "知识", "认知", "思考", "方法论", "逻辑", "教育", "课程", "理解", "观点", "真相"]),
    ("成长与行动", ["成长", "行动", "自律", "目标", "坚持", "努力", "习惯", "选择", "改变", "人生", "执行", "勇气"]),
    ("人际与社交", ["人际", "社交", "朋友", "关系", "沟通", "信任", "人脉", "圈子", "情商", "熟人", "同学", "相处", "合作"]),
    ("情绪与心理", ["情绪", "焦虑", "内耗", "心理", "快乐", "幸福", "痛苦", "恐惧", "压力", "能量", "精神", "孤独", "抑郁"]),
    ("亲密关系与家庭", ["婚姻", "恋爱", "爱情", "男人", "女人", "夫妻", "孩子", "父母", "家庭", "两性", "伴侣", "结婚"]),
    ("健康与生活", ["健康", "身体", "睡眠", "运动", "饮食", "医生", "疾病", "生活", "租房", "穿衣", "减肥", "养生"]),
    ("社会观察", ["社会", "底层", "阶层", "时代", "城市", "农村", "政策", "世界", "普通人", "年轻人", "中国", "环境"]),
]

SENTENCE_BREAK = re.compile(r"(?<=[。！？!?；;])|\n+")
CLAUSE_BREAK = re.compile(r"(?<=[，、：:。！？!?；;])")


def clean_text(text: str) -> str:
    text = text.replace("\r", "\n").replace("\u00a0", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n[ \t]+", "\n", text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"(?m)^\s*-{3,}\s*$", "", text)
    return text.strip()


def units(text: str) -> list[str]:
    return [part.strip() for part in SENTENCE_BREAK.split(text) if len(re.sub(r"\W", "", part)) >= 4]


def sentence_count(text: str) -> int:
    return len(units(text))


def hard_split(unit: str, max_chars: int) -> list[str]:
    if len(unit) <= max_chars:
        return [unit]
    clauses = [x.strip() for x in CLAUSE_BREAK.split(unit) if x.strip()]
    if len(clauses) <= 1:
        return [unit[i : i + max_chars] for i in range(0, len(unit), max_chars)]
    parts: list[str] = []
    buf = ""
    for clause in clauses:
        if buf and len(buf) + len(clause) > max_chars:
            parts.append(buf)
            buf = clause
        else:
            buf += clause
    if buf:
        parts.append(buf)
    return parts


def split_cards(text: str, max_chars: int = 280, min_chars: int = 90) -> list[str]:
    pieces: list[str] = []
    for unit in units(text):
        pieces.extend(hard_split(unit, max_chars))
    if not pieces:
        return [text]

    cards: list[str] = []
    buf = ""
    for piece in pieces:
        joiner = "\n" if buf else ""
        if buf and len(buf) + len(joiner) + len(piece) > max_chars:
            cards.append(buf)
            buf = piece
        else:
            buf += joiner + piece
    if buf:
        cards.append(buf)

    if len(cards) > 1 and len(cards[-1]) < min_chars and len(cards[-2]) + 1 + len(cards[-1]) <= 340:
        cards[-2] += "\n" + cards[-1]
        cards.pop()
    if len(cards) == 1:
        return cards
    return [f"【{i}/{len(cards)}】\n{card}" for i, card in enumerate(cards, 1)]


def classify(text: str) -> str:
    lowered = text.lower()
    scored: list[tuple[int, int, str]] = []
    for priority, (topic, keywords) in enumerate(TOPICS):
        score = 0
        for keyword in keywords:
            count = lowered.count(keyword)
            if count:
                score += count * (3 if len(keyword) >= 3 else 2)
        scored.append((score, -priority, topic))
    best = max(scored)
    return best[2] if best[0] else "生活感悟"


def parse_metrics(block: str) -> dict[str, int]:
    match = re.search(
        r"View:\s*(\d+)\s+Repost:\s*(\d+)\s+Reply:\s*(\d+)\s+Like:\s*(\d+)\s+Bookmark:\s*(\d+)",
        block,
    )
    if not match:
        return {"likes": 0, "replies": 0, "reposts": 0, "bookmarks": 0, "views": 0}
    views, reposts, replies, likes, bookmarks = map(int, match.groups())
    return {"likes": likes, "replies": replies, "reposts": reposts, "bookmarks": bookmarks, "views": views}


def parse_dontbesilent(pdf_path: Path) -> tuple[list[dict], dict]:
    reader = PdfReader(str(pdf_path))
    all_text = "\n".join(page.extract_text() or "" for page in reader.pages)
    markers = list(re.finditer(r"(?m)^#\s*(\d+)\s*$", all_text))
    source_posts: list[dict] = []
    rejected = 0
    for idx, marker in enumerate(markers):
        end = markers[idx + 1].start() if idx + 1 < len(markers) else len(all_text)
        block = all_text[marker.end() : end]
        published = re.search(r"Published:\s*(\d{4}-\d{2}-\d{2})\s+([0-9:]+)", block)
        body_match = re.search(r"Published:[^\n]*\n(.*?)(?=\nView:\s*\d+)", block, re.S)
        if not published or not body_match:
            rejected += 1
            continue
        text = clean_text(body_match.group(1))
        if sentence_count(text) <= 5:
            rejected += 1
            continue
        source_posts.append(
            {
                "source_id": int(marker.group(1)),
                "date": published.group(1),
                "datetime": f"{published.group(1)} {published.group(2)}",
                "text": text,
                "metrics": parse_metrics(block),
            }
        )
    return source_posts, {"detected": len(markers), "eligible": len(source_posts), "rejected": rejected, "pages": len(reader.pages)}


TS_PATTERN = re.compile(
    r"(20\d{2})\s*[/／]\s*(\d{1,2})\s*[/／]\s*(\d{1,2})\s+(\d{1,2})\s*[：:]\s*(\d{2})"
)


def normalize_ocr_page(raw: str) -> str:
    raw = re.sub(r"《\s*旷\s*野\s*之\s*心\s*》\s*作\s*者\s*[：:]\s*@?\s*M\s*o\s*r\s*r\s*i\s*s\s*[-_]?\s*L\s*T", "", raw, flags=re.I)
    raw = re.sub(r"《\s*旷\s*野\s*之\s*心\s*》", "", raw)
    raw = re.sub(r"作\s*者\s*[：:]", "", raw)
    raw = re.sub(r"@\s*M\s*o\s*r\s*r\s*i\s*s\s*[-_]?\s*L\s*T", "", raw, flags=re.I)
    raw = re.sub(r"\d+\s*/\s*409\s*$", "", raw)

    def stamp(match: re.Match[str]) -> str:
        year, month, day, hour, minute = map(int, match.groups())
        try:
            dt = datetime(year, month, day, hour, minute)
        except ValueError:
            return match.group(0)
        return f"@@TS:{dt:%Y-%m-%dT%H:%M}@@"

    raw = TS_PATTERN.sub(stamp, raw)
    raw = re.sub(r"\s+", "", raw)
    return raw


def parse_guide_ocr(ocr_dir: Path) -> tuple[list[dict], dict]:
    pages = sorted(ocr_dir.glob("page-*.txt"))
    corpus = "".join(normalize_ocr_page(path.read_text(encoding="utf-8-sig", errors="replace")) for path in pages)
    matches = list(re.finditer(r"@@TS:(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})@@", corpus))
    source_posts: list[dict] = []
    rejected = 0
    cursor = 0
    for idx, match in enumerate(matches):
        text = clean_text(corpus[cursor : match.start()])
        cursor = match.end()
        text = re.sub(r"^\d+/\d+", "", text)
        if not text or sentence_count(text) <= 5:
            rejected += 1
            continue
        source_posts.append(
            {
                "source_id": idx + 1,
                "date": match.group(1),
                "datetime": f"{match.group(1)} {match.group(2)}",
                "text": text,
                "metrics": {"likes": 0, "replies": 0, "reposts": 0, "bookmarks": 0, "views": 0},
            }
        )
    return source_posts, {"timestamps": len(matches), "eligible": len(source_posts), "rejected": rejected, "ocr_pages": len(pages)}


def expand_posts(source_posts: list[dict], source_key: str, source_name: str) -> list[dict]:
    output: list[dict] = []
    for item in source_posts:
        topic = classify(item["text"])
        cards = split_cards(item["text"])
        for part, text in enumerate(cards, 1):
            output.append(
                {
                    "id": f"pdf-{source_key}-{item['source_id']:04d}-{part:02d}",
                    "date": item["date"],
                    "datetime": item["datetime"],
                    "text": text,
                    "long": len(cards) > 1 or len(text) > 300,
                    "sourceUrl": "",
                    "topic": topic,
                    "metrics": item["metrics"],
                    "source": source_name,
                    "sourcePost": item["source_id"],
                    "part": part,
                    "parts": len(cards),
                }
            )
    return output


def dedupe(posts: list[dict]) -> list[dict]:
    seen: set[str] = set()
    result: list[dict] = []
    for post in posts:
        key = re.sub(r"\W+", "", post.get("text", "")).lower()
        if len(key) < 10 or key in seen:
            continue
        seen.add(key)
        result.append(post)
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tweets-pdf", type=Path, required=True)
    parser.add_argument("--guide-ocr", type=Path, required=True)
    parser.add_argument("--existing", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()

    dbs, dbs_report = parse_dontbesilent(args.tweets_pdf)
    guide, guide_report = parse_guide_ocr(args.guide_ocr)
    imported = expand_posts(dbs, "dbs", "dontbesilent 2430 条推文")
    imported += expand_posts(guide, "morris", "旷野之心-都市生存指南")
    imported = dedupe(imported)

    existing: list[dict] = []
    if args.existing and args.existing.exists():
        existing = json.loads(args.existing.read_text(encoding="utf-8-sig"))
        topic_aliases = {
            "AI 与工具": "AI与科技",
            "观察与思考": "生活感悟",
            "内容与流量": "自媒体与个人IP",
            "商业与产品": "商业与赚钱",
        }
        for post in existing:
            post["topic"] = topic_aliases.get(post.get("topic"), post.get("topic", "未分类"))
    existing_ids = {str(p.get("id")) for p in existing}
    merged = existing + [p for p in imported if str(p.get("id")) not in existing_ids]

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8")
    report = {
        "dontbesilent": dbs_report,
        "guide": guide_report,
        "eligible_source_posts": len(dbs) + len(guide),
        "generated_card_segments": len(imported),
        "existing_posts_preserved": len(existing),
        "final_posts": len(merged),
        "topics": dict(Counter(p["topic"] for p in imported)),
        "final_topics": dict(Counter(p.get("topic", "未分类") for p in merged)),
        "sources": dict(Counter(p["source"] for p in imported)),
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=True))


if __name__ == "__main__":
    main()
