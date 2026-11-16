"""スライドの複数案の検査で使う台本: 見本 slide-forms.json の definitions（場面 s3）を、2 枚に分けた案 B"""
import copy


def variant_b(sb):
    """definitions を def-usability と def-ux の 2 枚（場面 s3a・s3b）に分けた台本を返す"""
    out = copy.deepcopy(sb)
    blocks = {b["id"]: b for b in out["slides"]["definitions"]["parts"][1]["blocks"]}
    slides = {}
    for sid, sl in out["slides"].items():
        if sid != "definitions":
            slides[sid] = sl
            continue
        slides["def-usability"] = {"title": "ユーザビリティの定義", "statement": "ユーザビリティは、目標を達成できる度合いです。",
                                   "parts": [{"id": "du", "type": "text", "blocks": [blocks["u"], blocks["u1"]]}]}
        slides["def-ux"] = {"title": "UX の定義（規格）", "statement": "UX は、使うことで生じる知覚と反応です。",
                            "parts": [{"id": "dx", "type": "text", "blocks": [blocks["x"], blocks["x1"]]}]}
    out["slides"] = slides
    scenes = []
    for sc in out["scenes"]:
        if sc.get("slide") != "definitions":
            scenes.append(sc)
            continue
        scenes.append({"id": "s3a", "chapter": sc.get("chapter"), "slide": "def-usability", "lines": [
            {"id": "l4a", "text": "ユーザビリティの定義を、国際規格から引きます。", "do": [{"show": "du"}]}]})
        scenes.append({"id": "s3b", "chapter": sc.get("chapter"), "slide": "def-ux", "lines": [
            {"id": "l4b", "text": "次に、広いほうの定義です。", "do": [{"show": "dx"}]}]})
    out["scenes"] = scenes
    return out


OPTION_B_SLIDES = [{"id": "def-usability", "intent": "ユーザビリティの定義だけを、落ち着いて読める"},
                   {"id": "def-ux", "intent": "UX の定義だけを読める", "link": "同じ形で、広いほうの語に進む"}]
