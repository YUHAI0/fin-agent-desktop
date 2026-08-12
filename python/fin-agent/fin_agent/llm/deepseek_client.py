from fin_agent.config import Config
from fin_agent.llm.openai_client import OpenAICompatibleClient

class DeepSeekClient(OpenAICompatibleClient):
    def __init__(self):
        Config.validate()
        super().__init__(
            api_key=Config.DEEPSEEK_API_KEY,
            base_url=Config.DEEPSEEK_BASE_URL,
            model=Config.DEEPSEEK_MODEL
        )
