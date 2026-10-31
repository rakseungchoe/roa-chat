# ============================================
# Roa 벡터 장기기억 - ChromaDB (유저별 분리)
# ============================================

import os
import re
import uuid
import hashlib
from datetime import datetime
import chromadb
from chromadb.utils import embedding_functions

CHROMA_DIR = os.path.join(os.path.dirname(__file__), "chroma_db")
COLLECTION_NAME = "roa_memory"   # 레거시 단일 컬렉션 이름
MAX_MEMORIES_PER_USER = 100

# 민감 정보 패턴 (주민번호, 카드번호)
_SENSITIVE_PATTERNS = [
    re.compile(r'\d{6}-[1-4]\d{6}'),                              # 주민번호
    re.compile(r'\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}'),   # 카드번호
]

def _contains_sensitive(text: str) -> bool:
    return any(p.search(text) for p in _SENSITIVE_PATTERNS)

def _user_collection_name(username: str) -> str:
    """유저별 컬렉션 이름. Chroma 이름 규칙에 맞는 ASCII만 허용된다.

    예전에는 비허용 문자를 전부 '_'로 치환했는데, 그러면 "김철수"와 "이영희"가
    똑같이 "___"가 되어 서로 다른 사용자의 장기기억이 한 컬렉션에 섞였다
    (남의 대화가 내 컨텍스트에 주입되고, 한 명이 초기화하면 같이 지워졌다).
    치환이 일어난 경우에는 원본 username의 해시를 붙여 유일성을 보장한다.
    순수 ASCII 아이디는 기존 이름을 그대로 유지한다(기존 데이터 보존).

    또 Chroma는 컬렉션 이름의 끝이 영숫자가 아니면 거부한다. 아이디가 '-'나
    '_'로 끝나면(순수 ASCII라 치환은 안 일어나지만) 끝이 특수문자가 되어
    get_or_create_collection이 예외를 던지고 그 사용자만 장기기억이 조용히
    실패한다. 그런 경우도 해시 경로로 보내 이름 끝을 영숫자(hex)로 만든다.
    """
    safe = re.sub(r'[^a-zA-Z0-9_\-]', '_', username)
    if safe != username or not safe or not safe[-1].isalnum():
        digest = hashlib.sha256(username.encode()).hexdigest()[:16]
        prefix = safe.strip('_-')[:20]
        safe = f"{prefix}_{digest}" if prefix else digest
    return f"memory_{safe}"


def _get_embedding_fn():
    api_key = os.getenv("OPENAI_API_KEY")
    if api_key:
        return embedding_functions.OpenAIEmbeddingFunction(
            api_key=api_key,
            model_name="text-embedding-3-small"
        )
    return embedding_functions.DefaultEmbeddingFunction()


class VectorMemory:
    def __init__(self):
        self.client = chromadb.PersistentClient(path=CHROMA_DIR)
        self.ef = _get_embedding_fn()
        # 레거시 단일 컬렉션 (하위 호환)
        self.collection = self.client.get_or_create_collection(
            name=COLLECTION_NAME,
            embedding_function=self.ef,
            metadata={"hnsw:space": "cosine"}
        )
        # 유저별 컬렉션 캐시
        self._user_collections: dict = {}

    # ──────────────────────────────────────────
    # 유저별 컬렉션 관리
    # ──────────────────────────────────────────
    def _user_collection(self, username: str):
        """유저별 ChromaDB 컬렉션 반환 (캐시 사용)."""
        if username not in self._user_collections:
            col_name = _user_collection_name(username)
            self._user_collections[username] = self.client.get_or_create_collection(
                name=col_name,
                embedding_function=self.ef,
                metadata={"hnsw:space": "cosine"}
            )
        return self._user_collections[username]

    def _enforce_limit(self, username: str):
        """유저 기억이 MAX_MEMORIES_PER_USER 초과 시 오래된 것부터 삭제."""
        col = self._user_collection(username)
        count = col.count()
        if count <= MAX_MEMORIES_PER_USER:
            return
        # 시간순 정렬 후 초과분 삭제
        results = col.get(include=["metadatas"])
        ids = results["ids"]
        metas = results["metadatas"]
        # (id, time) 정렬
        paired = sorted(zip(ids, metas), key=lambda x: x[1].get("time", ""))
        to_delete = [pid for pid, _ in paired[:count - MAX_MEMORIES_PER_USER]]
        if to_delete:
            col.delete(ids=to_delete)

    # ──────────────────────────────────────────
    # 유저별 저장
    # ──────────────────────────────────────────
    def save_user(self, username: str, role: str, content: str, session_id: str = "") -> str:
        """유저 컬렉션에 대화 1턴 저장. 민감 정보 포함 시 무시."""
        if not content or not content.strip():
            return ""
        if _contains_sensitive(content):
            return ""
        col = self._user_collection(username)
        doc_id = str(uuid.uuid4())
        col.add(
            ids=[doc_id],
            documents=[content],
            metadatas=[{
                "role": role,
                "time": datetime.now().strftime("%Y-%m-%d %H:%M"),
                "session_id": session_id,
            }]
        )
        self._enforce_limit(username)
        return doc_id

    # ──────────────────────────────────────────
    # 유저별 검색
    # ──────────────────────────────────────────
    def search_user(self, username: str, query: str, n_results: int = 5) -> list:
        """유저 컬렉션에서 유사한 이전 대화 반환."""
        try:
            col = self._user_collection(username)
            count = col.count()
            if count == 0:
                return []
            n = min(n_results, count)
            results = col.query(
                query_texts=[query],
                n_results=n,
                include=["documents", "metadatas", "distances"]
            )
        except Exception:
            return []
        memories = []
        for doc, meta, dist in zip(
            results["documents"][0],
            results["metadatas"][0],
            results["distances"][0],
        ):
            memories.append({
                "role": meta.get("role", "unknown"),
                "content": doc,
                "time": meta.get("time", ""),
                "distance": round(dist, 3),
            })
        return memories

    def build_context_user(self, username: str, query: str, n_results: int = 5, threshold: float = 0.75) -> str:
        """유저 장기기억에서 관련 내용 검색 → 시스템 프롬프트용 문자열 반환."""
        memories = self.search_user(username, query, n_results=n_results)
        relevant = [m for m in memories if m["distance"] < threshold]
        if not relevant:
            return ""
        lines = ["[장기기억 - 관련 이전 대화]"]
        for m in relevant:
            lines.append(f"({m['time']}) {m['role']}: {m['content'][:200]}")
        lines.append("")
        return "\n".join(lines)

    # ──────────────────────────────────────────
    # 유저별 목록 / 삭제
    # ──────────────────────────────────────────
    def list_user(self, username: str, limit: int = 50) -> list:
        """유저 기억 목록 반환 (최근 순)."""
        col = self._user_collection(username)
        if col.count() == 0:
            return []
        results = col.get(include=["documents", "metadatas"])
        paired = list(zip(results["ids"], results["documents"], results["metadatas"]))
        paired.sort(key=lambda x: x[2].get("time", ""), reverse=True)
        return [
            {
                "id": pid,
                "role": meta.get("role", "unknown"),
                "content": doc[:150],
                "time": meta.get("time", ""),
            }
            for pid, doc, meta in paired[:limit]
        ]

    def count_user(self, username: str) -> int:
        return self._user_collection(username).count()

    def clear_user(self, username: str):
        """유저의 모든 장기기억 삭제 후 즉시 빈 컬렉션 재생성."""
        col_name = _user_collection_name(username)
        # 캐시 먼저 제거
        self._user_collections.pop(username, None)
        try:
            self.client.delete_collection(col_name)
        except Exception:
            pass
        # 즉시 빈 컬렉션 재생성 (다음 호출 시 오류 방지)
        self._user_collections[username] = self.client.get_or_create_collection(
            name=col_name,
            embedding_function=self.ef,
            metadata={"hnsw:space": "cosine"}
        )

    # ──────────────────────────────────────────
    # 레거시 단일 컬렉션 메서드 (하위 호환)
    # ──────────────────────────────────────────
    def save(self, role: str, content: str, session_id: str = "") -> str:
        if not content or not content.strip():
            return ""
        doc_id = str(uuid.uuid4())
        self.collection.add(
            ids=[doc_id],
            documents=[content],
            metadatas=[{
                "role": role,
                "time": datetime.now().strftime("%Y-%m-%d %H:%M"),
                "session_id": session_id,
            }]
        )
        return doc_id

    def search(self, query: str, n_results: int = 5, where: dict = None) -> list:
        count = self.collection.count()
        if count == 0:
            return []
        n = min(n_results, count)
        kwargs = dict(query_texts=[query], n_results=n, include=["documents", "metadatas", "distances"])
        if where:
            kwargs["where"] = where
        results = self.collection.query(**kwargs)
        memories = []
        for doc, meta, dist in zip(
            results["documents"][0],
            results["metadatas"][0],
            results["distances"][0],
        ):
            memories.append({
                "role": meta.get("role", "unknown"),
                "content": doc,
                "time": meta.get("time", ""),
                "distance": round(dist, 3),
            })
        return memories

    def build_context(self, query: str, n_results: int = 5, threshold: float = 0.75) -> str:
        memories = self.search(query, n_results=n_results)
        relevant = [m for m in memories if m["distance"] < threshold]
        if not relevant:
            return ""
        lines = ["[관련 이전 대화]"]
        for m in relevant:
            lines.append(f"({m['time']}) {m['role']}: {m['content'][:200]}")
        lines.append("")
        return "\n".join(lines)

    def migrate_json(self, json_path: str):
        import json
        flag = os.path.join(CHROMA_DIR, ".migrated")
        if os.path.exists(flag):
            return
        if not os.path.exists(json_path):
            return
        with open(json_path, "r", encoding="utf-8") as f:
            messages = json.load(f)
        if not messages:
            return
        print(f"🔄 기존 대화 {len(messages)}개 벡터DB로 마이그레이션 중...")
        for m in messages:
            self.save(
                role=m.get("role", "unknown"),
                content=m.get("content", ""),
                session_id="legacy",
            )
        os.makedirs(CHROMA_DIR, exist_ok=True)
        open(flag, "w").close()
        print("✅ 마이그레이션 완료!")

    def count(self) -> int:
        return self.collection.count()

    def clear_all(self):
        self.client.delete_collection(COLLECTION_NAME)
        self.collection = self.client.get_or_create_collection(
            name=COLLECTION_NAME,
            embedding_function=self.ef,
            metadata={"hnsw:space": "cosine"}
        )
