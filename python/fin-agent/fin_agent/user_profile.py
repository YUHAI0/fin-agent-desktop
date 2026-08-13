import json
import os
from typing import Dict, Any, Optional
from fin_agent.config import Config


class UserProfileManager:
    def __init__(self, file_path: str = None):
        if file_path:
            self.file_path = file_path
        else:
            # Default to user config directory
            config_dir = Config.get_config_dir()
            os.makedirs(config_dir, exist_ok=True)
            self.file_path = os.path.join(config_dir, "user_profile.json")

        self.profile = self._load_profile()

    def _load_profile(self) -> Dict[str, Any]:
        if not os.path.exists(self.file_path):
            return self._default_profile()
        try:
            with open(self.file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except Exception:
            return self._default_profile()
        return self._merge_defaults(data)

    def _default_profile(self) -> Dict[str, Any]:
        return {
            "risk_tolerance": "Unknown",  # Conservative, Balanced, Aggressive
            "investment_horizon": "Unknown",  # Short-term, Medium-term, Long-term
            "favorite_sectors": [],
            "avoid_sectors": [],
            "investment_style": "",  # Free text description
            "experience_level": "Unknown",  # beginner | experienced | Unknown
            "custom_preferences": {}  # Any other key-value pairs
        }

    def _merge_defaults(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """补齐旧文件缺失字段（仅内存，不强制写盘）。"""
        merged = self._default_profile()
        if isinstance(data, dict):
            merged.update(data)
        return merged

    def _save_profile(self):
        with open(self.file_path, 'w', encoding='utf-8') as f:
            json.dump(self.profile, f, ensure_ascii=False, indent=2)

    def update_profile(
        self,
        risk_tolerance: Optional[str] = None,
        investment_horizon: Optional[str] = None,
        favorite_sectors: Optional[list] = None,
        avoid_sectors: Optional[list] = None,
        investment_style: Optional[str] = None,
        experience_level: Optional[str] = None,
        **kwargs
    ):
        """
        Update user profile fields.
        用 is not None 判断，以便显式写入 Unknown / 空列表。
        空字符串不写入；experience_level 仅接受 beginner/experienced/Unknown。
        """
        if risk_tolerance is not None and risk_tolerance != "":
            self.profile["risk_tolerance"] = risk_tolerance
        if investment_horizon is not None and investment_horizon != "":
            self.profile["investment_horizon"] = investment_horizon
        if favorite_sectors is not None:
            self.profile["favorite_sectors"] = favorite_sectors
        if avoid_sectors is not None:
            self.profile["avoid_sectors"] = avoid_sectors
        if investment_style is not None and investment_style != "":
            self.profile["investment_style"] = investment_style
        if experience_level is not None:
            allowed = {"beginner", "experienced", "Unknown"}
            if experience_level not in allowed:
                raise ValueError("experience_level 无效")
            self.profile["experience_level"] = experience_level

        # Update custom preferences
        if kwargs:
            prefs = self.profile.setdefault("custom_preferences", {})
            if not isinstance(prefs, dict):
                prefs = {}
                self.profile["custom_preferences"] = prefs
            for k, v in kwargs.items():
                prefs[k] = v

        self._save_profile()
        return "用户画像已更新。"

    def completeness(self) -> Dict[str, Any]:
        p = self.get_profile()
        missing = []
        if p.get("risk_tolerance") in (None, "", "Unknown"):
            missing.append("risk_tolerance")
        if p.get("investment_horizon") in (None, "", "Unknown"):
            missing.append("investment_horizon")
        if p.get("experience_level") in (None, "", "Unknown"):
            missing.append("experience_level")
        if not p.get("favorite_sectors"):
            missing.append("favorite_sectors")
        total = 4
        score = int(round((total - len(missing)) / total * 100))
        return {"score": score, "missing": missing}

    def get_profile_summary(self) -> str:
        """
        Return a string summary of the user profile for LLM context.
        """
        p = self.get_profile()
        level = p.get("experience_level", "Unknown")
        level_map = {"beginner": "新手", "experienced": "老手", "Unknown": "未知"}
        level_label = level_map.get(level, "未知")
        if level == "beginner":
            style_hint = "用户为新手：解释术语、使用简版说明，避免堆砌专业指标。"
        elif level == "experienced":
            style_hint = "用户为老手：直接给数据与完整表格，少客套、少解释基础术语。"
        else:
            style_hint = "经验等级未知：用适中深度作答，必要时再询问。"

        risk_map = {
            "Conservative": "保守",
            "Balanced": "平衡",
            "Aggressive": "进取",
            "Unknown": "未知",
        }
        horizon_map = {
            "Short-term": "短期",
            "Medium-term": "中期",
            "Long-term": "长期",
            "Unknown": "未知",
        }
        risk = p.get("risk_tolerance", "Unknown")
        horizon = p.get("investment_horizon", "Unknown")
        favorites = p.get("favorite_sectors") or []
        avoids = p.get("avoid_sectors") or []

        summary = f"""用户画像：
- 经验等级：{level_label}
- 风险偏好：{risk_map.get(risk, risk)}
- 投资周期：{horizon_map.get(horizon, horizon)}
- 关注板块：{', '.join(favorites) if favorites else '未指定'}
- 回避板块：{', '.join(avoids) if avoids else '未指定'}
- 投资风格：{p.get('investment_style') or '未指定'}
- 表达要求：{style_hint}"""
        custom = p.get("custom_preferences") or {}
        if custom:
            summary += "\n- 其他偏好："
            for k, v in custom.items():
                summary += f"\n  - {k}: {v}"

        return summary.strip()

    def get_profile(self) -> Dict[str, Any]:
        self.profile = self._merge_defaults(self.profile)
        return self.profile
