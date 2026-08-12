from abc import ABC, abstractmethod

class LLMBase(ABC):
    @abstractmethod
    def chat(self, messages, tools=None, tool_choice=None, stream=False):
        """
        Send a chat completion request to the LLM.
        
        :param messages: List of message dictionaries (role, content).
        :param tools: List of tool definitions (optional).
        :param tool_choice: Tool choice strategy (optional).
        :param stream: Whether to stream the response (optional).
        :return: The response message object (if stream=False) or generator (if stream=True).
        """
        pass

