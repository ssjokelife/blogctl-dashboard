from prompts.adsense import get_strategy as adsense_strategy
from prompts.coupang import get_strategy as coupang_strategy
from prompts.naver_experience import get_strategy as naver_experience_strategy


def get_content_strategy(purpose: str) -> dict:
    strategies = {
        "coupang": coupang_strategy,
        "naver_experience": naver_experience_strategy,
    }
    fn = strategies.get(purpose, adsense_strategy)
    return fn()
