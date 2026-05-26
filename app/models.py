from sqlalchemy import Column, Integer, String, DateTime
from datetime import datetime
from .database import Base

class Document(Base):
    __tablename__ = "documents"

    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String)
    file_type = Column(String)
    gemini_file_uri = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)

class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True, index=True)
    role = Column(String) # 'user' or 'model'
    content = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)
