# ============================================
# Roa Web Server - Flask 백엔드 (보안 버전)
# ============================================

from flask import Flask, request, jsonify, send_from_directory, session, render_template, Response, stream_with_context
from flask_cors import CORS
from werkzeug.middleware.proxy_fix import ProxyFix
from pathlib import Path
from dotenv import load_dotenv
import os
import json
from roa_memory import VectorMemory

load_dotenv(Path(__file__).parent / '.env')
import re
import base64
import uuid
import sqlite3
import tempfile
import threading
from datetime import datetime, timedelta, date
import openai
import requests
import secrets
import hashlib
import bcrypt
import hmac
from collections import defaultdict
from functools import wraps
import time
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.header import Header

# ============================================
# 타임존 — 서버가 만드는 모든 시각의 기준
# ============================================
# datetime.now()는 프로세스 로컬 타임존을 따르는데, 배포 서버가 UTC라
# 녹음 제목·세션 시각·플래너 시각이 실제보다 9시간 이르게 찍혔다.
# 코드 곳곳의 datetime.now()를 하나씩 고치는 대신 프로세스 타임존을
# 한 번에 맞춘다. 서버에 TZ=UTC가 이미 걸려 있어도 덮어써야 하므로
# setdefault가 아니라 대입이며, 바꾸고 싶으면 ROA_TZ로 지정한다.
os.environ['TZ'] = os.getenv('ROA_TZ', 'Asia/Seoul')
if hasattr(time, 'tzset'):
    time.tzset()

app = Flask(__name__, static_folder='static/react', static_url_path='')
# Cloudflare Tunnel(단일 프록시) → Gunicorn. X-Forwarded-Host/Proto/For 신뢰.
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_port=1)
vector_memory = VectorMemory()
app.secret_key = os.getenv("SECRET_KEY", secrets.token_hex(32))
if not os.getenv("SECRET_KEY"):
    # 랜덤 키는 프로세스마다 다르다. gunicorn 워커가 2개 이상이거나 재시작하면
    # 발급한 세션 쿠키를 서로 검증하지 못해 로그인이 간헐적으로 풀린다.
    print("[경고] SECRET_KEY 환경변수가 없습니다. 멀티워커/재시작 시 모든 로그인 세션이 무효화됩니다.", flush=True)

# 요청 본문 상한. 미설정이면 무제한이라 초대형 요청 한 방으로 메모리를 태울 수 있다.
# 가장 큰 정상 업로드(Pro 오디오 200MB) + 여유로 잡는다.
app.config['MAX_CONTENT_LENGTH'] = 210 * 1024 * 1024

# 세션 쿠키 보안 플래그 (프로덕션은 Cloudflare HTTPS 서빙)
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SECURE'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'

# ============================================
# 에러 핸들러 - HTML 대신 JSON 응답
# ============================================
@app.errorhandler(404)
def not_found(e):
    return jsonify({"success": False, "error": "요청한 경로를 찾을 수 없습니다."}), 404

@app.errorhandler(500)
def internal_error(e):
    return jsonify({"success": False, "error": "서버 내부 오류가 발생했습니다."}), 500

@app.errorhandler(413)
def payload_too_large(e):
    return jsonify({"success": False, "error": "요청이 너무 커요. 파일 용량을 줄여서 다시 시도해주세요."}), 413

# ============================================
# 보안 1: CORS - ngrok 주소만 허용
# ============================================
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:5000").split(",")
CORS(app, origins=ALLOWED_ORIGINS, supports_credentials=True)

# ============================================
# 보안 2: 세션 만료 (24시간)
# ============================================
app.permanent_session_lifetime = timedelta(hours=24)

def _read_env(key, default):
    val = os.environ.get(key, default)
    return val.strip('"\'').strip()

ROA_USERNAME = _read_env("ROA_USERNAME", "roa")
ROA_PASSWORD = _read_env("ROA_PASSWORD", "")

# SMTP 로그인 계정(SMTP_EMAIL)과 수신자에게 보이는 "보낸사람"(SMTP_FROM)을 분리한다.
# Gmail 주소를 그대로 From에 쓰면 인증 메일이 스팸으로 분류되기 쉬워, 도메인
# 주소를 표시 주소로 쓴다. 로그인은 여전히 SMTP_EMAIL로 한다.
SMTP_FROM = os.getenv("SMTP_FROM") or os.getenv("SMTP_EMAIL", "")

# ============================================
# 회원가입 - SQLite 저장소
# ============================================
DB_FILE = Path(__file__).parent / 'roa.db'
FREE_DAILY_TOKEN_LIMIT  = 70_000
PRO_DAILY_TOKEN_LIMIT   = 280_000

FREE_DAILY_IMAGE_LIMIT  = 5      # Free 플랜 하루 이미지 생성 장수
PRO_DAILY_IMAGE_LIMIT   = 15     # Pro 플랜 하루 이미지 생성 장수

# 웹 검색은 OpenAI 내장 도구를 쓴다. 요청 1회가 8,000토큰 안팎 + 도구 요금이라
# 토큰 한도만으로는 통제가 약해 별도 횟수 제한을 둔다.
FREE_DAILY_SEARCH_LIMIT = 5
PRO_DAILY_SEARCH_LIMIT  = 20

# 한 메시지에 함께 볼 수 있는 이미지 장수. 1장이 대략 1,500토큰이라
# 상한이 없으면 한 번의 요청으로 하루치 토큰을 태울 수 있다.
# 프론트의 MAX_ATTACH_FILES와 같은 값으로 맞춰 둔다.
MAX_IMAGES_PER_MESSAGE = 5
_ATTACH_TYPES = ('image', 'pdf', 'video', 'audio', 'document')

# admin = 전부 무제한 (None)

# Whisper는 토큰이 아니라 분당 과금($0.006/분)이라 그대로는 토큰 한도에 안 잡힌다.
# Terra 혼합 단가(입력 56% × $2/1M + 출력 44% × $12/1M = $6.40/1M)로 나누면
# 1분 ≈ 937 토큰이므로, 계산이 명확하도록 1,000으로 둔다.
# 결과적으로 음성만 쓸 경우 Free 70분/일, Pro 280분/일에 해당한다.
WHISPER_TOKENS_PER_MINUTE = 1_000

# TTS(gpt-4o-mini-tts)도 문자 수가 아니라 만들어진 오디오 길이에 비례해 과금된다($0.015/분).
# 실측 환산: 한국어 3.86 토큰/자, 영어 2.86 토큰/자 (같은 $6.40/1M 기준).
# 한국어가 주 사용 언어라 4로 둔다.
TTS_TOKENS_PER_CHAR = 4

# 모델 입력 상한이 2,000 토큰인데 한국어는 밀도가 높아 4,096자면 2,371 토큰이 되어
# 400 에러가 난다(실측). 3,000자면 약 1,740 토큰으로 여유가 있다.
TTS_MAX_CHARS = 3_000

PLAN_CONFIG = {
    'free':  {'token_limit': FREE_DAILY_TOKEN_LIMIT, 'image_limit': FREE_DAILY_IMAGE_LIMIT,
              'search_limit': FREE_DAILY_SEARCH_LIMIT},
    'pro':   {'token_limit': PRO_DAILY_TOKEN_LIMIT,  'image_limit': PRO_DAILY_IMAGE_LIMIT,
              'search_limit': PRO_DAILY_SEARCH_LIMIT},
    'admin': {'token_limit': None,                   'image_limit': None,
              'search_limit': None},
}

FREE_SESSION_DAYS      = 30   # Free 플랜 세션 보관 일수
MAX_FREE_AUDIO_SIZE    = 25 * 1024 * 1024   # 25MB  (Free 플랜 오디오/영상)
MAX_PRO_AUDIO_SIZE     = 200 * 1024 * 1024  # 200MB (Pro/admin 오디오/영상, 청크 분할 지원 범위)
MAX_UPLOAD_SIZE        = 50 * 1024 * 1024   # 50MB  (문서/이미지, 플랜 구분 없음)

def get_upload_size(file):
    """업로드 스트림을 메모리에 올리지 않고 크기만 측정 (측정 후 위치 복원)"""
    file.seek(0, os.SEEK_END)
    size = file.tell()
    file.seek(0)
    return size

def get_user_plan(username):
    # Pro 부여 상태는 subscriptions 테이블을 참고한다.
    return get_effective_plan(username)

def check_media_size(file, plan):
    """오디오/영상 플랜별 상한 검사. 초과 시 에러 응답(dict), 통과 시 None."""
    size = get_upload_size(file)
    if plan == 'free' and size > MAX_FREE_AUDIO_SIZE:
        return {"success": False, "error": "파일이 너무 커요. Free 플랜은 25MB 이하만 가능해요. Pro 플랜은 긴 녹음을 지원해요."}
    if plan in ('pro', 'admin') and size > MAX_PRO_AUDIO_SIZE:
        return {"success": False, "error": "파일이 너무 커요. 200MB 이하만 업로드 가능해요."}
    return None

def check_upload_size(file):
    """문서/이미지 상한(50MB) 검사. 초과 시 에러 응답(dict), 통과 시 None."""
    if get_upload_size(file) > MAX_UPLOAD_SIZE:
        return {"success": False, "error": "파일이 너무 커요. 50MB 이하만 업로드 가능해요."}
    return None

def init_db():
    con = sqlite3.connect(DB_FILE)
    con.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            email TEXT NOT NULL,
            plan TEXT NOT NULL DEFAULT 'free',
            created TEXT NOT NULL
        )
    """)
    con.execute("""
        CREATE TABLE IF NOT EXISTS pending_users (
            username TEXT PRIMARY KEY,
            password_hash TEXT,
            email TEXT,
            code TEXT,
            expires REAL
        )
    """)
    con.execute("""
        CREATE TABLE IF NOT EXISTS token_usage (
            username TEXT NOT NULL,
            date TEXT NOT NULL,
            tokens INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (username, date)
        )
    """)
    con.execute("""
        CREATE TABLE IF NOT EXISTS image_usage (
            username TEXT NOT NULL,
            date TEXT NOT NULL,
            count INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (username, date)
        )
    """)
    con.execute("""
        CREATE TABLE IF NOT EXISTS user_settings (
            username TEXT PRIMARY KEY,
            language TEXT,
            tts_enabled INTEGER
        )
    """)
    con.execute("""
        CREATE TABLE IF NOT EXISTS search_usage (
            username TEXT NOT NULL,
            date TEXT NOT NULL,
            count INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (username, date)
        )
    """)
    con.execute("""
        CREATE TABLE IF NOT EXISTS pending_reset (
            email TEXT PRIMARY KEY,
            code TEXT NOT NULL,
            expires REAL NOT NULL
        )
    """)
    con.execute("""
        CREATE TABLE IF NOT EXISTS subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            plan TEXT NOT NULL,
            amount INTEGER NOT NULL,
            billing_key TEXT NOT NULL,
            customer_key TEXT NOT NULL,
            card_company TEXT,
            card_number_masked TEXT,
            status TEXT NOT NULL DEFAULT 'active',
            next_billing_date TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(username, plan)
        )
    """)
    # 기존 구독 및 결제 이력 테이블은 과거 기록과 수동 Pro 부여 호환을 위해 유지한다.
    con.execute("""
        CREATE TABLE IF NOT EXISTS billing_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            subscription_id INTEGER NOT NULL,
            order_id TEXT NOT NULL,
            amount INTEGER NOT NULL,
            status TEXT NOT NULL,
            payment_key TEXT,
            raw_response TEXT,
            created_at TEXT NOT NULL
        )
    """)
    con.execute("""
        CREATE TABLE IF NOT EXISTS login_attempts (
            ip TEXT NOT NULL,
            timestamp REAL NOT NULL
        )
    """)
    con.execute("CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts (ip)")
    # 자주 도는 조회 경로용 인덱스 (username/이메일 기준 조회, 탈퇴 시 결제이력 삭제)
    con.execute("CREATE INDEX IF NOT EXISTS idx_subscriptions_username ON subscriptions (username)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_billing_history_sub ON billing_history (subscription_id)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users (LOWER(email))")
    # 인증 코드 무차별 대입 방어용 시도 횟수 컬럼. 기존 DB에도 적용되도록
    # CREATE가 아니라 ALTER로 없을 때만 추가한다(멱등).
    for _tbl in ('pending_users', 'pending_reset'):
        _cols = [r[1] for r in con.execute(f"PRAGMA table_info({_tbl})")]
        if 'attempts' not in _cols:
            con.execute(f"ALTER TABLE {_tbl} ADD COLUMN attempts INTEGER DEFAULT 0")

    # 비밀번호 재설정을 (email, username) 조합으로 특정하기 위한 컬럼.
    # 한 이메일에 여러 아이디가 있을 수 있어, 어느 계정 대상인지 담아야 한다.
    _pr_cols = [r[1] for r in con.execute("PRAGMA table_info(pending_reset)")]
    if 'username' not in _pr_cols:
        con.execute("ALTER TABLE pending_reset ADD COLUMN username TEXT")

    # 관리자 계정 자동 생성 (환경변수 기반, 이미 있으면 건너뜀)
    if ROA_PASSWORD and not con.execute("SELECT 1 FROM users WHERE username = ?", (ROA_USERNAME,)).fetchone():
        admin_hash = bcrypt.hashpw(ROA_PASSWORD.encode(), bcrypt.gensalt()).decode()
        con.execute(
            "INSERT OR IGNORE INTO users (username, password_hash, email, plan, created) VALUES (?, ?, ?, ?, ?)",
            (ROA_USERNAME, admin_hash, '', 'admin', datetime.now().isoformat())
        )
    con.commit()
    con.close()

def get_daily_tokens(username):
    today = datetime.now().strftime("%Y-%m-%d")
    con = sqlite3.connect(DB_FILE)
    row = con.execute("SELECT tokens FROM token_usage WHERE username=? AND date=?", (username, today)).fetchone()
    con.close()
    return row[0] if row else 0

def add_daily_tokens(username, tokens):
    if not tokens:
        return
    today = datetime.now().strftime("%Y-%m-%d")
    con = sqlite3.connect(DB_FILE)
    con.execute("""
        INSERT INTO token_usage (username, date, tokens) VALUES (?, ?, ?)
        ON CONFLICT(username, date) DO UPDATE SET tokens = tokens + excluded.tokens
    """, (username, today, tokens))
    con.commit()
    con.close()

def get_daily_image_count(username):
    today = datetime.now().strftime("%Y-%m-%d")
    con = sqlite3.connect(DB_FILE)
    row = con.execute("SELECT count FROM image_usage WHERE username=? AND date=?", (username, today)).fetchone()
    con.close()
    return row[0] if row else 0

def add_daily_image_count(username):
    today = datetime.now().strftime("%Y-%m-%d")
    con = sqlite3.connect(DB_FILE)
    con.execute("""
        INSERT INTO image_usage (username, date, count) VALUES (?, ?, 1)
        ON CONFLICT(username, date) DO UPDATE SET count = count + 1
    """, (username, today))
    con.commit()
    con.close()

# ── 계정 설정 (언어·TTS) ─────────────────────────────────────────────
# 예전에는 브라우저 localStorage에만 있어서 기기를 바꾸면 초기화됐다.
# 이제 계정에 붙이고, localStorage는 첫 화면을 즉시 그리기 위한 캐시로만 쓴다.
# 값이 없으면(None) "아직 설정한 적 없음"이라는 뜻이고, 클라이언트가
# 브라우저 기본값이나 남아있는 로컬 값으로 1회 이관한다.
def get_user_settings(username):
    con = sqlite3.connect(DB_FILE)
    row = con.execute(
        "SELECT language, tts_enabled FROM user_settings WHERE username=?", (username,)
    ).fetchone()
    con.close()
    if not row:
        return {"language": None, "tts_enabled": None}
    return {
        "language": row[0] if row[0] in ('ko', 'en') else None,
        "tts_enabled": None if row[1] is None else bool(row[1]),
    }


def set_user_settings(username, language=None, tts_enabled=None):
    """부분 갱신. 넘기지 않은 항목은 기존 값을 유지한다."""
    cur = get_user_settings(username)
    lang = language if language in ('ko', 'en') else cur["language"]
    tts = cur["tts_enabled"] if tts_enabled is None else bool(tts_enabled)
    con = sqlite3.connect(DB_FILE)
    con.execute("""
        INSERT INTO user_settings (username, language, tts_enabled) VALUES (?, ?, ?)
        ON CONFLICT(username) DO UPDATE SET language=excluded.language, tts_enabled=excluded.tts_enabled
    """, (username, lang, None if tts is None else int(tts)))
    con.commit()
    con.close()
    return {"language": lang, "tts_enabled": tts}


def get_daily_search_count(username):
    today = datetime.now().strftime("%Y-%m-%d")
    con = sqlite3.connect(DB_FILE)
    row = con.execute("SELECT count FROM search_usage WHERE username=? AND date=?", (username, today)).fetchone()
    con.close()
    return row[0] if row else 0

def add_daily_search_count(username):
    today = datetime.now().strftime("%Y-%m-%d")
    con = sqlite3.connect(DB_FILE)
    con.execute("""
        INSERT INTO search_usage (username, date, count) VALUES (?, ?, 1)
        ON CONFLICT(username, date) DO UPDATE SET count = count + 1
    """, (username, today))
    con.commit()
    con.close()

def whisper_tokens(seconds):
    """Whisper 사용 시간(초)을 토큰 한도에 합산할 환산값으로 바꾼다."""
    return int(round(max(0.0, seconds or 0.0) / 60.0 * WHISPER_TOKENS_PER_MINUTE))

def probe_media_seconds(path):
    """ffprobe로 오디오/영상 길이(초)를 얻는다. 알 수 없으면 0.0."""
    import subprocess
    try:
        p = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", path],
            capture_output=True, text=True, timeout=30
        )
        return max(0.0, float(p.stdout.strip()))
    except Exception as e:
        print(f"[probe_media_seconds] failed: {e}")
        return 0.0

def get_pro_subscription(username):
    """유효 기간이 남은 Pro 부여 1건을 반환한다.
    기존 유료 구독은 마지막 결제일까지 유지되며, 수동 부여는 저장된 만료일을 따른다.
    """
    today = datetime.now().strftime('%Y-%m-%d')
    con = sqlite3.connect(DB_FILE)
    con.row_factory = sqlite3.Row
    row = con.execute(
        "SELECT * FROM subscriptions WHERE username=? "
        "AND status IN ('active','canceled') AND next_billing_date >= ? "
        "ORDER BY id DESC LIMIT 1",
        (username, today)
    ).fetchone()
    con.close()
    return dict(row) if row else None

def get_effective_plan(username):
    """실제 적용 플랜 (admin/pro/free). Pro는 유효 기간이 남은 부여에 한해 적용한다."""
    if username == ROA_USERNAME:
        return 'admin'
    user = get_user(username)
    if not user:
        return 'free'
    if user.get('plan') == 'admin':
        return 'admin'
    if get_pro_subscription(username):
        return 'pro'
    return 'free'

def get_token_limit(username):
    plan = get_effective_plan(username)
    return PLAN_CONFIG.get(plan, PLAN_CONFIG['free'])['token_limit']

def get_user(username):
    con = sqlite3.connect(DB_FILE)
    con.row_factory = sqlite3.Row
    row = con.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    con.close()
    return dict(row) if row else None

def create_user(username, password, plan='free'):
    ph = hash_password(password)
    created = datetime.now().isoformat()
    con = sqlite3.connect(DB_FILE)
    con.execute(
        "INSERT INTO users (username, password_hash, email, plan, created) VALUES (?, ?, ?, ?, ?)",
        (username, ph, '', plan, created)
    )
    con.commit()
    con.close()

def create_user_full(username, password_hash, email, plan='free'):
    created = datetime.now().isoformat()
    con = sqlite3.connect(DB_FILE)
    con.execute(
        "INSERT INTO users (username, password_hash, email, plan, created) VALUES (?, ?, ?, ?, ?)",
        (username, password_hash, email, plan, created)
    )
    con.commit()
    con.close()

def hash_password(pw):
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()

def verify_password(pw, hashed):
    if not hashed:
        return False
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except (ValueError, TypeError):
        return False

init_db()

# ============================================
# 보안 3: IP 화이트리스트
# ============================================
ALLOWED_IPS_RAW = os.getenv("ALLOWED_IPS", "")
ALLOWED_IPS = [ip.strip() for ip in ALLOWED_IPS_RAW.split(",") if ip.strip()]

@app.before_request
def check_ip_whitelist():
    # ALLOWED_IPS 비어있으면 모두 허용 (설정 안한 경우)
    if not ALLOWED_IPS:
        return
    # 정적 파일은 제외
    if request.path.startswith('/assets'):
        return
    ip = get_client_ip()
    if ip not in ALLOWED_IPS:
        return jsonify({"success": False, "error": "접근 거부"}), 403

# ============================================
# 보안 - 로그인 실패 횟수 제한 (브루트포스 방어)
# ============================================
MAX_ATTEMPTS = 5       # 최대 시도 횟수
LOCKOUT_TIME = 300     # 잠금 시간 (초) = 5분

# 비밀번호 복잡도: 영문 + 숫자 + 특수문자 포함 8자 이상 (회원가입/재설정 공용)
PW_REGEX = re.compile(r'^(?=.*[a-zA-Z])(?=.*\d)(?=.*[!@#$%^&*()\-_=+\[\]{};\':"\\|,.<>/?`~]).{8,}$')

# 아이디: 2~32자, 공백·제어문자 불가 (신규 가입에만 적용 — 기존 계정 로그인은 무관)
USERNAME_MAX = 32
_USERNAME_BAD_RE = re.compile(r'[\s\x00-\x1f\x7f]')
# 이메일: 엄밀한 RFC 검증이 아니라 "메일이 갈 수 있는 형태"인지만 본다
EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')


def _username_error(username):
    """신규 가입 아이디 형식 검사. 문제 없으면 None, 있으면 에러 문구."""
    if len(username) < 2:
        return "아이디는 2자 이상이어야 합니다."
    if len(username) > USERNAME_MAX:
        return f"아이디는 {USERNAME_MAX}자 이하여야 합니다."
    if _USERNAME_BAD_RE.search(username):
        return "아이디에 공백이나 제어문자는 쓸 수 없습니다."
    return None

# 인증 로그 파일 (~/Roa/logs/auth.log)
AUTH_LOG_DIR = Path(__file__).parent / 'logs'
AUTH_LOG_FILE = AUTH_LOG_DIR / 'auth.log'

def write_auth_log(event, ip, username, reason=None):
    """로그인 성공/실패를 auth.log에 한 줄 기록. 실패해도 로그인 흐름은 막지 않는다."""
    try:
        AUTH_LOG_DIR.mkdir(parents=True, exist_ok=True)
        ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        line = f"[{ts}] {event} ip={ip} username={username}"
        if reason:
            line += f" reason={reason}"
        with open(AUTH_LOG_FILE, 'a', encoding='utf-8') as f:
            f.write(line + "\n")
    except Exception as e:
        print(f"[auth log 실패] {e}")

ACCESS_LOG_FILE = AUTH_LOG_DIR / 'access.log'

def write_access_log(username=None):
    """일반 API 호출을 access.log에 한 줄 기록 (내부자 위협 사후 추적용).
    logs/ 디렉토리는 write_auth_log()가 생성. 실패해도 API 흐름은 막지 않는다."""
    try:
        ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        line = f"[{ts}] {request.method} {request.path} ip={get_client_ip()} user={username or 'anonymous'}"
        with open(ACCESS_LOG_FILE, 'a', encoding='utf-8') as f:
            f.write(line + "\n")
    except Exception as e:
        print(f"[access log 실패] {e}")

def get_client_ip():
    # ProxyFix(x_for=1)가 신뢰할 수 있는 프록시(Cloudflare Tunnel) 기준으로
    # remote_addr를 이미 복원해 준다. X-Forwarded-For를 직접 읽으면(특히 첫 값)
    # 클라이언트가 임의 헤더를 붙여 로그인 잠금·레이트리밋·IP 화이트리스트를
    # 전부 우회할 수 있다.
    return (request.remote_addr or '').strip()

def _purge_old_attempts(con, ip):
    con.execute("DELETE FROM login_attempts WHERE ip=? AND timestamp < ?", (ip, time.time() - LOCKOUT_TIME))

def get_attempt_count(ip):
    """LOCKOUT_TIME 이내 실패 횟수"""
    con = sqlite3.connect(DB_FILE)
    _purge_old_attempts(con, ip)
    con.commit()
    n = con.execute("SELECT COUNT(*) FROM login_attempts WHERE ip=?", (ip,)).fetchone()[0]
    con.close()
    return n

def get_first_attempt_time(ip):
    """LOCKOUT_TIME 이내 가장 오래된 실패 시각 (없으면 None)"""
    con = sqlite3.connect(DB_FILE)
    row = con.execute(
        "SELECT MIN(timestamp) FROM login_attempts WHERE ip=? AND timestamp >= ?",
        (ip, time.time() - LOCKOUT_TIME)
    ).fetchone()
    con.close()
    return row[0] if row and row[0] is not None else None

def is_locked_out(ip):
    return get_attempt_count(ip) >= MAX_ATTEMPTS

def record_failed_attempt(ip):
    con = sqlite3.connect(DB_FILE)
    _purge_old_attempts(con, ip)
    con.execute("INSERT INTO login_attempts (ip, timestamp) VALUES (?, ?)", (ip, time.time()))
    con.commit()
    con.close()

def clear_attempts(ip):
    con = sqlite3.connect(DB_FILE)
    con.execute("DELETE FROM login_attempts WHERE ip=?", (ip,))
    con.commit()
    con.close()

# ============================================
# 보안 - API 요청 속도 제한 (Rate Limiting)
# ============================================
api_requests = defaultdict(list)
user_api_requests = defaultdict(list)
API_LIMIT = 30         # IP 기반 분당 최대 요청 (기본)
API_WINDOW = 60        # 시간 창 (초)

def check_rate_limit(username=None):
    now = time.time()
    # username 기반 (플랜별 차등): /api/chat 전용
    if username:
        if username == ROA_USERNAME:
            return True  # admin 무제한
        plan = get_effective_plan(username)
        if plan == 'admin':
            return True
        limit = 60 if plan == 'pro' else 30  # Pro 60회, Free 30회
        user_api_requests[username] = [t for t in user_api_requests[username] if now - t < API_WINDOW]
        if len(user_api_requests[username]) >= limit:
            return False
        user_api_requests[username].append(now)
        return True
    # IP 기반 (기본)
    ip = get_client_ip()
    api_requests[ip] = [t for t in api_requests[ip] if now - t < API_WINDOW]
    if len(api_requests[ip]) >= API_LIMIT:
        return False
    api_requests[ip].append(now)
    return True

# 이메일 발송 남용(메일 폭탄) 방지용 IP 쿨다운. 계정 존재 여부와 무관하게
# 조회 전에 검사해야 응답 차이로 계정을 열거당하지 않는다. (단일 워커 전제 —
# 멀티워커면 레이트리밋 등과 함께 공유 저장소로 옮겨야 한다)
_mail_send_times = {}
MAIL_SEND_COOLDOWN = 60


def _mail_cooldown_ok(ip):
    """직전 발송으로부터 MAIL_SEND_COOLDOWN초가 지났으면 True(그리고 시각 갱신)."""
    now = time.time()
    # 오래된 항목 정리 (무한 증가 방지)
    for k in [k for k, ts in _mail_send_times.items() if now - ts > MAIL_SEND_COOLDOWN * 10]:
        _mail_send_times.pop(k, None)
    if now - _mail_send_times.get(ip, 0) < MAIL_SEND_COOLDOWN:
        return False
    _mail_send_times[ip] = now
    return True


def check_login():
    return session.get('username') if session.get('logged_in') else None


def _internal_error(tag, e, msg="처리 중 오류가 발생했어요. 잠시 후 다시 시도해주세요."):
    """예외 상세는 서버 로그에만 남기고 사용자에겐 일반 안내만 준다.
    str(e)를 그대로 응답에 실으면 내부 경로·라이브러리·스택 정보가 노출된다."""
    print(f"[{tag}] {type(e).__name__}: {e}", flush=True)
    return jsonify({"success": False, "error": msg})

def login_required(f):
    """로그인 필수 API용. 인증 실패 시 access.log 에 anonymous 로 남기고 401.
    통과하면 username 을 첫 번째 인자로 넘긴다."""
    @wraps(f)
    def decorated(*args, **kwargs):
        username = check_login()
        if not username:
            write_access_log(None)
            return jsonify({"success": False, "error": "로그인이 필요합니다."}), 401
        return f(username, *args, **kwargs)
    return decorated

def usage_limited(f):
    """플랜별 rate limit + 일일 토큰 한도 체크.
    login_required 바로 다음에 붙인다(username을 첫 인자로 받으므로).
    AI를 호출해 비용이 발생하는 라우트는 전부 이 데코레이터를 거쳐야 한다."""
    @wraps(f)
    def decorated(username, *args, **kwargs):
        # 플랜별 rate limit (Pro 60/min, Free 30/min)
        if not check_rate_limit(username):
            return jsonify({"success": False, "error": "요청이 너무 많아요. 잠시 후 다시 시도하세요."}), 429

        # 토큰 한도 체크
        token_limit = get_token_limit(username)
        if token_limit is not None:
            used = get_daily_tokens(username)
            if used >= token_limit:
                return jsonify({
                    "success": False,
                    "error": f"오늘 사용량({token_limit:,} 토큰 한도)을 모두 사용했어요. 내일 자정에 초기화됩니다.",
                    "token_limit_exceeded": True
                }), 429
        return f(username, *args, **kwargs)
    return decorated

@app.route('/api/me')
@login_required
def api_me(username):
    daily_tokens = get_daily_tokens(username)
    token_limit = get_token_limit(username)
    plan = get_effective_plan(username)
    return jsonify({
        "success": True,
        "username": username,
        "plan": plan,
        "daily_tokens": daily_tokens,
        "daily_token_limit": token_limit,
        # 언어·TTS는 계정 설정이다. 프론트가 어차피 /api/me를 부르므로
        # 별도 왕복 없이 여기에 얹어 보낸다.
        "settings": get_user_settings(username),
    })


@app.route('/api/settings', methods=['POST'])
@login_required
def update_settings(username):
    """언어·TTS 설정 저장. 보낸 항목만 바뀐다."""
    data = request.json or {}
    lang = data.get('language')
    tts = data.get('tts_enabled')
    if lang is not None and lang not in ('ko', 'en'):
        return jsonify({"success": False, "error": "지원하지 않는 언어예요"}), 400
    saved = set_user_settings(
        username,
        language=lang,
        tts_enabled=None if tts is None else bool(tts),
    )
    return jsonify({"success": True, "settings": saved})

# ============================================
# API 연결 (Lazy Loading - 실제 호출 시 초기화)
# ============================================
_openai_client = None

def openai_client():
    global _openai_client
    if _openai_client is None:
        _openai_client = openai.OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    return _openai_client

ROA_SYSTEM_BASE = """너는 Roa야. 사용자의 개인 AI 어시스턴트.
친근하고 스마트하게 도와줘.

[Roa가 제공하는 기능]
- 멀티 AI 모델 지원 (Claude, GPT, Gemini 등 선택 가능)
- 이미지 분석 / PDF 분석 / 영상 분석 / 유튜브 영상 요약·분석
- 음성 대화 (STT 입력, TTS 응답)
- 회의록 자동 작성
- 이미지 생성
- 웹 검색
- 날씨 조회
- 플래너 (일정 관리)
- 장기 기억 (이전 대화 내용 기억)

사용자가 어떤 기능이 가능한지 물으면 위 목록을 바탕으로 안내해줘."""

def build_roa_system(lang='ko'):
    if lang == 'en':
        return ROA_SYSTEM_BASE + "\n\nAlways respond in English."
    return ROA_SYSTEM_BASE + "\n\n항상 한국어로 대답해."

ROA_SYSTEM = build_roa_system('ko')

# ============================================
# 기억력 (다중 세션)
# ============================================
SESSIONS_DIR = "sessions"
os.makedirs(SESSIONS_DIR, exist_ok=True)

def _safe_username(username):
    """경로 탐색 공격 방지: username에서 경로 구분자 제거"""
    return os.path.basename(username) if username else None

def user_sessions_dir(username):
    safe = _safe_username(username)
    if not safe:
        raise ValueError("username이 필요합니다")
    d = os.path.join(SESSIONS_DIR, safe)
    os.makedirs(d, exist_ok=True)
    return d

# 세션 id 화이트리스트. 서버가 만드는 sid는 숫자 20자리(%Y%m%d%H%M%S%f)이거나
# "migrated_..." 뿐이라 이 패턴이면 충분하다. 경로 구분자(/ \)·상위 이동(..)·
# 널바이트·공백은 전부 걸러진다.
_SID_RE = re.compile(r'^[A-Za-z0-9_-]{1,64}$')


def _safe_sid(sid):
    """sid를 파일 경로에 쓰기 전에 검증한다. 통과하면 그대로 반환.

    session_id는 URL 경로뿐 아니라 /api/chat 등의 요청 body로도 들어온다.
    body는 Flask의 <sid> 라우팅 검증(슬래시 차단)을 거치지 않으므로,
    "../다른유저/세션" 같은 값으로 남의 폴더에 접근할 수 있었다. 여기서 막는다.
    """
    if not isinstance(sid, str) or not _SID_RE.match(sid):
        raise ValueError("잘못된 세션 id")
    return sid


def session_file(sid, username):
    """항상 username 기반 경로 반환 (루트 폴백 없음). sid는 경로 탈출 불가."""
    return os.path.join(user_sessions_dir(username), f"{_safe_sid(sid)}.json")


def _bad_sid(sid):
    """요청으로 들어온 선택적 session_id 검증. 잘못됐으면 (에러응답, 400) 반환.

    업로드 라우트들은 AI 호출(비용 발생) 뒤에 add_to_session에서야 sid를 쓰는데,
    거기서 ValueError가 나면 과금은 됐는데 저장은 실패한 채 500으로 죽는다.
    비용이 발생하기 전에 여기서 걸러낸다.
    """
    if not sid:
        return None
    try:
        _safe_sid(sid)
        return None
    except ValueError:
        return jsonify({"success": False, "error": "잘못된 세션 id예요"}), 400


# ---- 생성 이미지 영속화 -----------------------------------------------------
# 세션 JSON에 base64를 넣으면 파일이 장당 1~2MB씩 불어나므로, 파일로 저장하고
# 메시지에는 접근 URL만 남긴다. sessions/{username}/ 아래에 두면 탈퇴 시
# purge_user_files의 rmtree가 이미지까지 함께 지운다.
IMAGE_URL_PREFIX = "/api/images/"
_IMAGE_NAME_RE = re.compile(r"^[0-9a-f]{32}\.png$")


def user_images_dir(username):
    d = os.path.join(user_sessions_dir(username), "images")
    os.makedirs(d, exist_ok=True)
    return d


def save_generated_image(username, b64):
    """생성 이미지를 사용자 폴더에 저장하고 접근 URL을 돌려준다."""
    name = f"{uuid.uuid4().hex}.png"
    path = os.path.join(user_images_dir(username), name)
    with open(path, "wb") as f:
        f.write(base64.b64decode(b64))
    return IMAGE_URL_PREFIX + name


def _image_name_from_url(url):
    """세션에 저장된 URL에서 파일명만 안전하게 뽑는다. 형식이 다르면 None."""
    if not isinstance(url, str) or not url.startswith(IMAGE_URL_PREFIX):
        return None
    name = os.path.basename(url[len(IMAGE_URL_PREFIX):])
    return name if _IMAGE_NAME_RE.match(name) else None


def delete_generated_images(username, messages):
    """메시지들이 참조하는 이미지 파일을 삭제한다 (세션/답변 삭제 시 고아 방지)."""
    base = None
    for m in messages or []:
        name = _image_name_from_url((m or {}).get("generatedImage"))
        if not name:
            continue
        if base is None:
            base = user_images_dir(username)
        try:
            os.unlink(os.path.join(base, name))
        except OSError:
            pass

# ---- 녹음(회의록) 저장 ------------------------------------------------------
# 세션과 같은 방식으로 사용자별 폴더에 JSON 하나씩 저장한다.
# sessions/ 와 나란히 두면 탈퇴 시 purge_user_files가 함께 지우기 쉽다.
# 오디오 원본은 보관하지 않고 전사 원문(transcript)과 요약(summary)만 남긴다.
RECORDINGS_DIR = "recordings"
_RECORDING_ID_RE = re.compile(r"^[0-9]{14,26}$")


def user_recordings_dir(username):
    safe = _safe_username(username)
    if not safe:
        raise ValueError("username이 필요합니다")
    d = os.path.join(RECORDINGS_DIR, safe)
    os.makedirs(d, exist_ok=True)
    return d


def recording_file(rid, username):
    return os.path.join(user_recordings_dir(username), f"{rid}.json")


def load_recording(rid, username):
    """녹음 1건 반환. 없거나 id 형식이 이상하면 None."""
    if not _RECORDING_ID_RE.match(str(rid or "")):
        return None
    f = recording_file(rid, username)
    if not os.path.exists(f):
        return None
    try:
        with open(f, "r", encoding="utf-8") as fp:
            return json.load(fp)
    except Exception as e:
        print(f"[recording] load failed ({rid}): {e}")
        return None


def save_recording(data, username):
    """임시 파일 → os.replace 로 원자적 저장 (세션과 동일)."""
    path = recording_file(data["id"], username)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".tmp-", suffix=".part")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


# 요약 프롬프트가 고정으로 내보내는 섹션 머리말.
# 제목이 날짜·시간이라 카드에서 "무슨 내용"을 알려주는 건 preview뿐인데,
# 머리말로 시작하면 보이는 두 줄을 그냥 날린다.
_SUMMARY_HEADERS = ("내용 요약", "주요 항목", "중요 포인트", "요약", "액션 아이템", "핵심 내용")


def _summary_preview(summary, limit=120):
    """카드용 요약 미리보기. 머리말 줄을 건너뛰고 실제 내용부터 담는다."""
    parts = []
    for raw in (summary or "").splitlines():
        line = re.sub(r"^[\s\W_]+", "", raw).strip()
        if not line:
            continue
        if not parts and any(line.startswith(h) and len(line) <= len(h) + 2 for h in _SUMMARY_HEADERS):
            continue
        parts.append(line)
        if sum(len(p) for p in parts) >= limit:
            break
    return " ".join(parts)[:limit]


def list_recordings(username):
    """목록용 요약 정보만 최신순으로. 본문(transcript)은 싣지 않는다."""
    try:
        base = user_recordings_dir(username)
    except ValueError:
        return []
    items = []
    for fname in os.listdir(base):
        if not fname.endswith(".json"):
            continue
        rid = fname[:-5]
        d = load_recording(rid, username)
        if not d:
            continue
        items.append({
            "id": d.get("id", rid),
            "title": d.get("title", ""),
            "created": d.get("created", ""),
            "duration": d.get("duration", 0),
            "preview": _summary_preview(d.get("summary")),
        })
    items.sort(key=lambda x: x["id"], reverse=True)
    return items


# ---- 세션 파일 동시성 -------------------------------------------------------
# 백그라운드 응답 생성 스레드와 사용자 요청이 같은 세션 파일을 동시에
# read-modify-write 하므로 세션별 락으로 직렬화한다.
# RLock인 이유: add_to_session/load_session 같은 헬퍼가 바깥 락 안에서
# 다시 호출되기 때문에 재진입이 필요하다.
_session_locks = {}
_session_locks_guard = threading.Lock()

# pending이 이 시간(초)을 넘겨 갱신되지 않으면 서버 재시작 등으로 유실된 작업으로 본다.
PENDING_TIMEOUT = 300


def get_session_lock(sid, username):
    key = f"{username}/{_safe_sid(sid)}"
    with _session_locks_guard:
        lock = _session_locks.get(key)
        if lock is None:
            lock = threading.RLock()
            _session_locks[key] = lock
        return lock


def _sweep_stale_pending(sid, username, data):
    """유실된 생성 작업의 pending을 정리하고 안내 메시지를 남긴다.
    (프로세스 재시작으로 백그라운드 스레드가 사라진 경우)"""
    pending = data.get("pending")
    if not pending:
        return data
    last = pending.get("updated") or pending.get("started") or 0
    if (time.time() - last) < PENDING_TIMEOUT:
        return data
    data.pop("pending", None)
    if pending.get("kind") != "regenerate":
        data.setdefault("messages", []).append({
            "role": "assistant",
            "content": "응답 생성이 중단됐어요. 다시 시도해 주세요.",
            "time": datetime.now().strftime("%Y-%m-%d %H:%M"),
            "regenerable": True,
        })
    save_session(sid, data, username)
    return data


def load_session(sid, username):
    f = session_file(sid, username)
    if os.path.exists(f):
        with get_session_lock(sid, username):
            with open(f, "r", encoding="utf-8") as fp:
                data = json.load(fp)
            return _sweep_stale_pending(sid, username, data)
    return {"id": sid, "title": "새 채팅", "messages": [], "created": datetime.now().strftime("%Y-%m-%d %H:%M")}

def save_session(sid, data, username):
    """임시 파일에 쓰고 os.replace()로 교체 — 읽는 쪽이 부분 기록된 JSON을
    보거나, 쓰는 도중 죽어서 세션이 통째로 날아가는 일을 막는다."""
    path = session_file(sid, username)
    with get_session_lock(sid, username):
        # 접미사를 .json으로 두면 list_sessions가 임시 파일을 세션으로 오인한다.
        fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".tmp-", suffix=".part")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            os.replace(tmp, path)
        except Exception:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise

def list_sessions(username):
    """username 폴더의 세션만 반환 (다른 유저 세션 노출 없음)"""
    if not username:
        return []
    base = user_sessions_dir(username)
    sessions = []
    for fname in sorted(os.listdir(base), reverse=True):
        if fname.endswith(".json"):
            sid = fname[:-5]
            try:
                with open(os.path.join(base, sid + ".json"), "r", encoding="utf-8") as f:
                    d = json.load(f)
                if d.get("messages"):  # 메시지 있는 세션만 표시
                    sessions.append({
                        "id": sid,
                        "title": d.get("title", "새 채팅"),
                        "created": d.get("created", ""),
                        # 프로젝트 연결. 연결 없는 세션은 None으로 내려간다.
                        "projectId": d.get("projectId"),
                    })
            except: pass
    return sessions

def migrate_root_sessions():
    """루트 sessions/ 에 있는 기존 세션 파일들을 ROA_USERNAME 폴더로 이동 (최초 1회)"""
    target_dir = user_sessions_dir(ROA_USERNAME)
    for fname in os.listdir(SESSIONS_DIR):
        if not fname.endswith(".json"):
            continue
        src = os.path.join(SESSIONS_DIR, fname)
        dst = os.path.join(target_dir, fname)
        if os.path.isfile(src) and not os.path.exists(dst):
            os.rename(src, dst)

def purge_user_files(username):
    """username 소유의 디스크 데이터(세션 폴더 + 플래너 파일 + 장기기억) 모두 삭제.
    탈퇴 시, 그리고 같은 username 재가입 시 이전 흔적을 지우기 위해 사용."""
    import shutil
    safe = _safe_username(username)
    if not safe:
        return
    # 1) sessions/{username}/ 폴더 통째 삭제
    try:
        sessions_dir = os.path.join(SESSIONS_DIR, safe)
        if os.path.exists(sessions_dir):
            shutil.rmtree(sessions_dir)
    except Exception:
        pass
    # 2) recordings/{username}/ 폴더 통째 삭제
    try:
        rec_dir = os.path.join(RECORDINGS_DIR, safe)
        if os.path.exists(rec_dir):
            shutil.rmtree(rec_dir)
    except Exception:
        pass
    # 3-1) projects/{username}.json 삭제
    try:
        proj_path = Path(__file__).parent / 'projects' / f'{safe}.json'
        if proj_path.exists():
            proj_path.unlink()
    except Exception:
        pass
    # 3) planners/{username}.json 삭제
    try:
        planner_path = Path(__file__).parent / 'planners' / f'{safe}.json'
        if planner_path.exists():
            planner_path.unlink()
    except Exception:
        pass
    # 4) ChromaDB 장기기억 삭제 (있을 때만)
    try:
        vector_memory.clear_user(username)
    except Exception:
        pass

def cleanup_free_sessions(username):
    """Free 플랜: 30일 이상 된 세션 파일 자동 삭제"""
    base = user_sessions_dir(username)
    cutoff = datetime.now() - timedelta(days=FREE_SESSION_DAYS)
    for fname in os.listdir(base):
        if not fname.endswith('.json'):
            continue
        fpath = os.path.join(base, fname)
        try:
            with open(fpath, 'r', encoding='utf-8') as f:
                d = json.load(f)
            created_str = d.get('created', '')
            if created_str:
                created_dt = datetime.strptime(created_str, "%Y-%m-%d %H:%M")
                if created_dt < cutoff:
                    delete_generated_images(username, d.get('messages'))
                    os.unlink(fpath)
        except:
            pass

def add_to_session(sid, role, content, username, attachments=None, regenerable=None):
    """attachments: [{"name": ..., "type": ...}] — 첨부 파일의 이름·종류만 남긴다(표시용).
    regenerable: 이 답변을 재생성할 수 있는지. assistant 메시지에만 의미가 있다.

    ── regenerable 규약 ──────────────────────────────────────────────
    세션 최상위의 `pending`(생성 진행 상태)과는 완전히 별개다.
    pending은 "지금 만들고 있는 중인가"라는 일시적 상태이고,
    regenerable은 "이 답변을 다시 만들 수 있는가"라는 메시지의 영구 속성이다.

    판정은 저장 시점에 서버가 확정한다. 첨부가 있던 질문의 답변은 파일을
    다시 올릴 방법이 없어 재생성할 수 없다(hasAttachment). 생성 이미지는
    재생성 시 finalize_generation이 구 파일을 지우고 다시 만들므로 제약이
    아니다 — 그래서 hasImage는 저장하지 않는다.

    값이 True일 때만 재생성이 가능하다. 키가 없는 과거 세션은 판정 근거가
    없으므로 재생성 불가로 본다(버튼만 안 보일 뿐 다른 기능은 그대로다).
    """
    with get_session_lock(sid, username):
        data = load_session(sid, username)
        msg = {"role": role, "content": content, "time": datetime.now().strftime("%Y-%m-%d %H:%M")}
        if attachments:
            msg["fileAttachments"] = attachments
        if regenerable is not None:
            msg["regenerable"] = bool(regenerable)
        data["messages"].append(msg)
        # 첫 user 메시지로 제목 설정
        if role == "user" and data["title"] == "새 채팅":
            data["title"] = content[:20] + ("..." if len(content) > 20 else "")
        save_session(sid, data, username)
        return data

# 기존 memory.json 호환
MEMORY_FILE = "memory.json"

def load_memory():
    if os.path.exists(MEMORY_FILE):
        with open(MEMORY_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return []

def save_memory(messages):
    with open(MEMORY_FILE, "w", encoding="utf-8") as f:
        json.dump(messages, f, ensure_ascii=False, indent=2)

def add_to_memory(messages, role, content):
    messages.append({"role": role, "content": content, "time": datetime.now().strftime("%Y-%m-%d %H:%M")})
    save_memory(messages)
    return messages


# ---- 답변 재생성 지원 -------------------------------------------------------
# 재생성은 이미 저장된 user 발화를 다시 저장하면 안 되고, 폐기할 구 assistant
# 답변을 지운 뒤 새 답변을 넣어야 한다.
def pop_last_assistant_memory(messages):
    """memory.json(세션 없는 경로)에서 마지막 assistant 메시지 하나를 제거한다."""
    for i in range(len(messages) - 1, -1, -1):
        if messages[i].get("role") == "assistant":
            messages.pop(i)
            save_memory(messages)
            break
    return messages


def strip_last_exchange(messages, user_message=None):
    """모델에 넘길 이력용 사본을 만든다. 뒤쪽 assistant 답변(폐기 대상)을 떼고,
    이어서 나오는 동일한 user 발화도 뗀다 — 호출부가 현재 message를 다시 붙이므로
    그대로 두면 같은 질문이 두 번 들어간다. 원본 리스트는 건드리지 않는다."""
    trimmed = list(messages)
    while trimmed and trimmed[-1].get("role") == "assistant":
        trimmed.pop()
    if (user_message is not None and trimmed
            and trimmed[-1].get("role") == "user"
            and trimmed[-1].get("content") == user_message):
        trimmed.pop()
    return trimmed

def get_recent_messages(messages, limit=20):
    recent = messages[-limit:] if len(messages) > limit else messages
    return [{"role": m["role"], "content": m["content"]} for m in recent]

# ============================================
# 플래너 (할일/일정/메모)
# ============================================
# 플래너는 사용자별로 분리 저장한다. 예전에는 루트의 planner.json 하나를
# 모든 사용자가 공유해서 남의 할 일·일정·메모가 그대로 보였다.
# purge_user_files가 지우는 경로(planners/{username}.json)와도 이제 일치한다.
# purge_user_files가 Path(__file__).parent / 'planners' 를 지우므로 같은 기준을 쓴다
# (상대 경로로 두면 실행 CWD가 다를 때 저장 경로와 삭제 경로가 어긋난다).
# ============================================
# 프로젝트 (사용자별 파일 저장 — 플래너·녹음과 동일 패턴)
# ============================================
# 예전에는 브라우저 localStorage에만 있어서 기기를 바꾸면 목록이 비어 보였다.
# 세션 파일의 projectId가 가리키는 대상이므로, 이관할 때 id를 반드시 보존한다.
PROJECTS_DIR = Path(__file__).parent / 'projects'


def project_file(username):
    safe = _safe_username(username)
    if not safe:
        raise ValueError("username이 필요합니다")
    os.makedirs(PROJECTS_DIR, exist_ok=True)
    return os.path.join(PROJECTS_DIR, f"{safe}.json")


def load_projects(username):
    f = project_file(username)
    if not os.path.exists(f):
        return []
    try:
        with open(f, "r", encoding="utf-8") as fp:
            data = json.load(fp)
    except Exception as e:
        print(f"[projects] load failed ({username}): {e}", flush=True)
        return []
    items = data.get("projects") if isinstance(data, dict) else data
    return items if isinstance(items, list) else []


def save_projects(username, items):
    """플래너와 동일하게 임시 파일 → os.replace 로 원자적 저장."""
    path = project_file(username)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".tmp-", suffix=".part")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump({"projects": items}, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _sorted_projects(items):
    """최근 연 순서(MRU). lastOpened가 없으면 created로 대신한다."""
    return sorted(items, key=lambda p: (p.get("lastOpened") or p.get("created") or ""), reverse=True)


PLANNERS_DIR = Path(__file__).parent / 'planners'

def planner_file(username):
    safe = _safe_username(username)
    if not safe:
        raise ValueError("username이 필요합니다")
    os.makedirs(PLANNERS_DIR, exist_ok=True)
    return os.path.join(PLANNERS_DIR, f"{safe}.json")

def load_planner(username):
    f = planner_file(username)
    if os.path.exists(f):
        try:
            with open(f, "r", encoding="utf-8") as fp:
                data = json.load(fp)
        except Exception as e:
            print(f"[planner] load failed ({username}): {e}")
            data = {}
    else:
        data = {}
    # 키가 빠져 있어도 이후 코드가 KeyError로 죽지 않게 채워준다
    for key in ("todos", "schedules", "memos"):
        data.setdefault(key, [])
    return data

def save_planner(username, data):
    """세션과 동일하게 임시 파일 → os.replace 로 원자적 저장."""
    path = planner_file(username)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".tmp-", suffix=".part")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise

@app.route('/api/projects', methods=['GET'])
@login_required
def api_projects(username):
    return jsonify({"success": True, "projects": _sorted_projects(load_projects(username))})


@app.route('/api/projects', methods=['POST'])
@login_required
def api_project_create(username):
    """프로젝트 생성. 클라이언트가 id를 지정할 수 있다.

    localStorage 이관 때 기존 id를 그대로 넘겨야 하기 때문이다 — 서버가 새 id를
    부여하면 세션 파일에 이미 박혀 있는 projectId와의 연결이 전부 끊어진다.
    같은 id가 이미 있으면 새로 만들지 않고 그대로 둔다(이관을 여러 번 돌려도 안전).
    """
    data = request.json or {}
    name = str(data.get('name') or '').strip()[:80]
    if not name:
        return jsonify({"success": False, "error": "이름이 필요해요"}), 400
    items = load_projects(username)
    pid = str(data.get('id') or '').strip()[:64] or datetime.now().strftime("%Y%m%d%H%M%S%f")
    existing = next((p for p in items if p.get("id") == pid), None)
    if existing:
        return jsonify({"success": True, "project": existing, "created": False})
    project = {
        "id": pid,
        "name": name,
        "icon": str(data.get('icon') or '📁')[:8],
        "desc": str(data.get('desc') or '').strip()[:300],
        "memo": str(data.get('memo') or '')[:20000],
        "created": str(data.get('created') or datetime.now().strftime("%Y-%m-%d %H:%M"))[:32],
        "lastOpened": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }
    items.append(project)
    save_projects(username, items)
    return jsonify({"success": True, "project": project, "created": True})


@app.route('/api/projects/<pid>', methods=['PUT'])
@login_required
def api_project_update(username, pid):
    """이름·아이콘·설명·메모 수정. touch=true면 MRU 순서만 갱신한다."""
    data = request.json or {}
    items = load_projects(username)
    target = next((p for p in items if p.get("id") == pid), None)
    if not target:
        return jsonify({"success": False, "error": "프로젝트를 찾을 수 없어요"}), 404
    if data.get('touch'):
        target["lastOpened"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    for key, limit in (("name", 80), ("icon", 8), ("desc", 300), ("memo", 20000)):
        if key in data and data[key] is not None:
            target[key] = str(data[key])[:limit]
    save_projects(username, items)
    return jsonify({"success": True, "project": target})


@app.route('/api/projects/<pid>', methods=['DELETE'])
@login_required
def api_project_delete(username, pid):
    """프로젝트 삭제. 이 프로젝트를 가리키던 세션의 projectId도 함께 정리한다
    (그냥 두면 존재하지 않는 프로젝트를 가리키는 값이 계속 남는다)."""
    items = load_projects(username)
    remain = [p for p in items if p.get("id") != pid]
    if len(remain) != len(items):
        save_projects(username, remain)

    detached = 0
    try:
        base = user_sessions_dir(username)
        for fname in os.listdir(base):
            if not fname.endswith(".json"):
                continue
            sid = fname[:-5]
            try:
                with get_session_lock(sid, username):
                    with open(os.path.join(base, fname), "r", encoding="utf-8") as f:
                        d = json.load(f)
                    if d.get("projectId") != pid:
                        continue
                    d.pop("projectId", None)
                    save_session(sid, d, username)
                    detached += 1
            except Exception:
                continue
    except Exception as e:
        print(f"[projects] session sweep failed ({username}): {e}", flush=True)
    return jsonify({"success": True, "detached": detached})


@app.route('/api/planner', methods=['GET'])
@login_required
def get_planner(username):
    return jsonify({"success": True, "data": load_planner(username)})

@app.route('/api/planner/todos', methods=['POST'])
@login_required
def add_todo(username):
    body = request.get_json(silent=True) or {}
    text = str(body.get("text") or "").strip()[:500]
    if not text: return jsonify({"success": False, "error": "내용 필요"}), 400
    data = load_planner(username)
    todo = {"id": datetime.now().strftime("%Y%m%d%H%M%S%f"), "text": text, "done": False, "created": datetime.now().strftime("%Y-%m-%d %H:%M")}
    data["todos"].insert(0, todo)
    save_planner(username, data)
    return jsonify({"success": True, "todo": todo})

@app.route('/api/planner/todos/<tid>', methods=['PUT'])
@login_required
def update_todo(username, tid):
    body = request.get_json(silent=True) or {}
    data = load_planner(username)
    for t in data["todos"]:
        if t["id"] == tid:
            if "done" in body: t["done"] = bool(body["done"])
            if "text" in body:
                new_text = str(body["text"] or "").strip()[:500]
                if new_text: t["text"] = new_text
            break
    save_planner(username, data)
    return jsonify({"success": True})

@app.route('/api/planner/todos/<tid>', methods=['DELETE'])
@login_required
def delete_todo(username, tid):
    data = load_planner(username)
    data["todos"] = [t for t in data["todos"] if t["id"] != tid]
    save_planner(username, data)
    return jsonify({"success": True})

@app.route('/api/planner/schedules', methods=['POST'])
@login_required
def add_schedule(username):
    body = request.get_json(silent=True) or {}
    title = str(body.get("title") or "").strip()[:200]
    date = str(body.get("date") or "").strip()[:32]
    if not title or not date: return jsonify({"success": False, "error": "제목/날짜 필요"}), 400
    data = load_planner(username)
    schedule = {
        "id": datetime.now().strftime("%Y%m%d%H%M%S%f"),
        "title": title, "date": date,
        "time": str(body.get("time") or "").strip()[:16],
        "created": datetime.now().strftime("%Y-%m-%d %H:%M")
    }
    data["schedules"].append(schedule)
    data["schedules"].sort(key=lambda x: x["date"] + x.get("time", ""))
    save_planner(username, data)
    return jsonify({"success": True, "schedule": schedule})

@app.route('/api/planner/schedules/<sid>', methods=['DELETE'])
@login_required
def delete_schedule(username, sid):
    data = load_planner(username)
    data["schedules"] = [s for s in data["schedules"] if s["id"] != sid]
    save_planner(username, data)
    return jsonify({"success": True})

@app.route('/api/planner/memos', methods=['POST'])
@login_required
def add_memo(username):
    body = request.get_json(silent=True) or {}
    content = str(body.get("content") or "").strip()[:10000]
    if not content: return jsonify({"success": False, "error": "내용 필요"}), 400
    data = load_planner(username)
    memo = {"id": datetime.now().strftime("%Y%m%d%H%M%S%f"), "content": content, "created": datetime.now().strftime("%Y-%m-%d %H:%M")}
    data["memos"].insert(0, memo)
    save_planner(username, data)
    return jsonify({"success": True, "memo": memo})

@app.route('/api/planner/memos/<mid>', methods=['PUT'])
@login_required
def update_memo(username, mid):
    body = request.get_json(silent=True) or {}
    data = load_planner(username)
    for m in data["memos"]:
        if m["id"] == mid:
            if "content" in body:
                new_content = str(body["content"] or "").strip()[:10000]
                if new_content: m["content"] = new_content
            break
    save_planner(username, data)
    return jsonify({"success": True})

@app.route('/api/planner/memos/<mid>', methods=['DELETE'])
@login_required
def delete_memo(username, mid):
    data = load_planner(username)
    data["memos"] = [m for m in data["memos"] if m["id"] != mid]
    save_planner(username, data)
    return jsonify({"success": True})

# ============================================
# 웹 검색
# ============================================
# ============================================
# 날씨
# ============================================
def get_weather():
    try:
        api_key = os.getenv("OPENWEATHER_API_KEY")
        if not api_key:
            return None   # 키 미설정: appid=None으로 요청하면 401 본문을 파싱하다 깨진다
        city = os.getenv("WEATHER_CITY", "Asan")
        url = f"http://api.openweathermap.org/data/2.5/weather?q={city}&appid={api_key}&units=metric&lang=kr"
        res = requests.get(url, timeout=6).json()
        return {
            "city": city,
            "temp": res['main']['temp'],
            "feels": res['main']['feels_like'],
            "desc": res['weather'][0]['description'],
            "humidity": res['main']['humidity']
        }
    except:
        return None

# ============================================
# AI 응답
# ============================================
# ---- OpenAI Function Calling: 이미지 생성 도구 ------------------------------
# 키워드 매칭 대신 모델이 대화 맥락을 보고 "언제 만들지"를 판단하고,
# "어떻게 그릴지"(영어 이미지 프롬프트)까지 함수 인자로 직접 작성한다.
GENERATE_IMAGE_FUNCTION = {
    "name": "generate_image",
    "description": (
        "Generate an image for the user. Call this whenever the conversation makes it clear that the user "
        "wants a picture, illustration, poster, diagram, thumbnail, wallpaper or any other visual artifact — "
        "including indirect follow-ups that only make sense in context, such as \"그럼 그거 만들어줄래?\", "
        "\"이미지로 보여줘\", \"아까 그 장면 그려줘\", \"다시 그려줘\". "
        "Do NOT call it when the user wants text, code, a table or an explanation. "
        "Resolve references like \"아까 그거\", \"다시\", \"각각\" from the conversation history yourself before "
        "writing the prompt. Only ask a clarifying question instead of calling the tool when you genuinely "
        "cannot tell what should be in the picture."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "prompt": {
                "type": "string",
                "description": (
                    "The image prompt in ENGLISH (the descriptive prose must be English; text rendered inside the "
                    "image follows the label rule below), written for an image-generation model. "
                    "One to three sentences. "
                    "Describe only what should be VISIBLE: subject, composition, layout, style, colors, lighting. "
                    "NEVER copy conversational instructions (\"그려줘\", \"만들어줘\", \"이미지로\", \"please draw\") "
                    "into the prompt — they describe the request, not the picture. "
                    "Mention text or labels inside the image only when the user clearly wants a chart/table/poster "
                    "with labels, and then give the exact short labels to render, in the SAME language the user is "
                    "conversing in (Korean labels for Korean conversations, English labels for English "
                    "conversations), and nothing else. gpt-image-2 renders non-Latin scripts including Korean with "
                    "high accuracy, so do not force English labels when the user is speaking Korean. "
                    "For an informational graphic (schedule, routine table, chart), describe a clean designed "
                    "infographic with its concrete structure (rows, columns, headings)."
                ),
            },
            "description": {
                "type": "string",
                "description": "A short description, in the user's own language, of what you are about to generate.",
            },
        },
        "required": ["prompt", "description"],
    },
}

# ---- OpenAI Function Calling: 웹 검색 도구 ---------------------------------
# 예전에는 "오늘/지금/최신" 같은 키워드가 message에 있으면 무조건 검색 결과를
# 끼워넣었다. 일상어라 오탐이 잦아 불필요한 검색이 붙었고, 정작 필요한
# 질문은 놓쳤다. 이제 모델이 대화 맥락을 보고 직접 판단해 호출한다.
# 설명이 길면 매 요청 입력 토큰으로 나가므로 짧게 유지한다.
WEB_SEARCH_FUNCTION = {
    "name": "web_search",
    "description": (
        "Search the web for current information. Use it when the answer depends on facts you cannot "
        "know reliably — today's news, weather, prices, sports results, recent events, or anything "
        "that changed after your training. Do NOT use it for general knowledge, math, coding, "
        "writing, or things already stated in this conversation. "
        "For CURRENCY EXCHANGE RATES use get_exchange_rate instead — this tool reads cached web "
        "pages and returns weeks-old rates."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": (
                    "What to look up, as a clear self-contained phrase or question — a search "
                    "assistant reads it and browses for you, so plain wording works better than "
                    "bare keywords. Include the specific thing you need (currency pair, index "
                    "name, city). Do not add today's date; the searcher already knows it. "
                    "Use the language most likely to have good sources (Korean for Korean topics)."
                ),
            },
        },
        "required": ["query"],
    },
}

# ---- OpenAI Function Calling: 환율 도구 -------------------------------------
# 환율을 web_search로 처리하면 investing.com 같은 JS 렌더링 페이지의 낡은 크롤
# 캐시를 읽어 몇 주 전 종가가 "오늘 환율"로 나온다(실측 1,419~1,540원, 편차 8%).
# 전용 API는 편차 0.3%에 기준일이 명시돼 있어 날씨처럼 따로 뺀다.
EXCHANGE_RATE_FUNCTION = {
    "name": "get_exchange_rate",
    "description": (
        "Get the current currency exchange rate between two currencies. Use this — never web_search — "
        "for any question about exchange rates or currency conversion, including \"오늘 환율\", "
        "\"달러 얼마야\", \"100달러는 몇 원\", \"엔화 환율\". Returns a market mid-rate with its "
        "reference date."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "base": {
                "type": "string",
                "description": "Currency being converted FROM, as a 3-letter ISO code (USD, JPY, EUR, KRW).",
            },
            "quote": {
                "type": "string",
                "description": (
                    "Currency being converted TO, as a 3-letter ISO code. Default to KRW when the user "
                    "is speaking Korean and has not said otherwise."
                ),
            },
            "amount": {
                "type": "number",
                "description": "Optional. Amount of the base currency to convert, when the user asks about a specific sum.",
            },
        },
        "required": ["base", "quote"],
    },
}

# Chat Completions API가 요구하는 래핑 형식
GENERATE_IMAGE_TOOL = {"type": "function", "function": GENERATE_IMAGE_FUNCTION}
WEB_SEARCH_TOOL = {"type": "function", "function": WEB_SEARCH_FUNCTION}
EXCHANGE_RATE_TOOL = {"type": "function", "function": EXCHANGE_RATE_FUNCTION}

# 내장 검색이 이미 요약해서 주므로 스니펫 나열보다 짧아도 된다.
# 이후 라운드 입력으로 계속 재전송되므로 넉넉하되 과하지 않게 자른다.
WEB_SEARCH_MAX_CHARS = 1_200

# tool_calls → tool 결과 → 최종 답변까지 최대 4라운드.
# 마지막 라운드는 tools를 빼서 반드시 텍스트 답변으로 끝나게 한다.
# (검색 → 재검색 → 답변처럼 다단계가 필요한 경우를 위해 3에서 올림)
MAX_TOOL_ROUNDS = 4

# GPT-5.6 계열은 max_tokens/temperature를 받지 않는다.
# (max_completion_tokens 사용, temperature는 기본값 1 고정)
# reasoning_effort를 생략하면 추론이 켜져 토큰·지연이 늘어나므로 명시적으로 끈다.
GPT_CHAT_MODEL = "gpt-5.6-terra"
GPT_REASONING_EFFORT = "none"

# 영상 분석 시 모델에 넘길 최대 프레임 수.
# 기존에도 실제로 도달하던 경로(Claude)가 15장이었으므로 동작을 유지한다.
MAX_VIDEO_FRAMES = 15


def gpt_image_part(b64, media_type="image/jpeg", detail=None):
    """base64 이미지를 OpenAI 멀티모달 파트로 감싼다.
    (Anthropic의 {"type":"image","source":{...}} 에 대응)"""
    part = {"type": "image_url", "image_url": {"url": f"data:{media_type};base64,{b64}"}}
    if detail:
        part["image_url"]["detail"] = detail
    return part


def gpt_complete(content, system=None, max_tokens=2048):
    """도구 없이 한 번 주고받는 단발 호출. content는 문자열 또는 멀티모달 파트 리스트.
    반환: (텍스트, 총 토큰수)"""
    response = openai_client().chat.completions.create(
        model=GPT_CHAT_MODEL,
        reasoning_effort=GPT_REASONING_EFFORT,
        max_completion_tokens=max_tokens,
        messages=[
            {"role": "system", "content": system if system is not None else ROA_SYSTEM},
            {"role": "user", "content": content},
        ],
    )
    tokens = response.usage.total_tokens if response.usage else 0
    return (response.choices[0].message.content or ""), tokens


# ============================================
# 스트리밍: (delta_text, None) 들을 yield 한 뒤
# 마지막에 ('', {'answer': full, 'tokens': N, 'image_url': str|None}) 한 번 yield.
# 호출자(/api/chat ?stream=1)가 SSE로 변환해서 내보낸다.
#
# image_hook: generate_image 호출이 나왔을 때 실행되는 콜백.
#   image_hook(prompt) -> (저장된_이미지_URL_or_None, 모델에게 돌려줄 tool 결과 텍스트)
#   None이면 tools 없이 순수 텍스트 대화로 동작한다.
# ============================================
def _tool_arg(raw, key):
    """스트리밍으로 조립한 함수 인자(JSON 문자열)에서 값 하나를 꺼낸다.
    OpenAI는 인자를 조각난 문자열로 흘려보내므로 잘려서 도착할 수 있다.
    파싱이 실패해도 생성 전체가 죽지 않도록 None을 돌려준다."""
    try:
        data = json.loads(raw or "{}")
    except (ValueError, TypeError) as e:
        print(f"[tool_args] parse failed: {e} / raw={(raw or '')[:200]!r}")
        return None
    if not isinstance(data, dict):
        return None
    value = data.get(key)
    return value if isinstance(value, str) and value.strip() else None


def _tool_num(raw, key):
    """_tool_arg의 숫자판. 모델이 수량을 문자열("100")로 보내는 경우도 받아준다."""
    try:
        data = json.loads(raw or "{}")
    except (ValueError, TypeError):
        return None
    if not isinstance(data, dict):
        return None
    try:
        return float(data.get(key))
    except (TypeError, ValueError):
        return None


# ---- 환율 조회 --------------------------------------------------------------
# 두 공급자 모두 하루 1회 갱신이라 30분 캐시로 충분하다.
# open.er-api는 24시간에 1회 초과 호출 시 429를 주므로 캐시가 특히 중요하다.
EXCHANGE_RATE_TTL = 1_800
_exchange_rate_cache = {}                  # (base, quote) -> (fetched_at, payload)
_exchange_rate_lock = threading.Lock()
_CURRENCY_RE = re.compile(r'^[A-Za-z]{3}$')


def _fetch_frankfurter(base, quote):
    """1순위. 중앙은행 고시 기준, 쿼터 없음, 키 불필요."""
    res = requests.get(
        f"https://api.frankfurter.dev/v1/latest?base={base}&symbols={quote}",
        timeout=6,
    )
    res.raise_for_status()
    data = res.json()
    rate = (data.get("rates") or {}).get(quote)
    if rate is None:
        raise ValueError(f"no rate for {base}/{quote}")
    return {"rate": float(rate), "asof": data.get("date") or "?",
            "source": "Frankfurter (European Central Bank reference rates)"}


def _fetch_er_api(base, quote):
    """폴백. 키 불필요지만 24시간에 1회 넘게 부르면 429."""
    res = requests.get(f"https://open.er-api.com/v6/latest/{base}", timeout=6)
    res.raise_for_status()
    data = res.json()
    rate = (data.get("rates") or {}).get(quote)
    if rate is None:
        raise ValueError(f"no rate for {base}/{quote}")
    return {"rate": float(rate), "asof": data.get("time_last_update_utc") or "?",
            "source": "Exchange Rate API (exchangerate-api.com)"}


def run_exchange_rate(base, quote, amount=None):
    """get_exchange_rate 도구 호출 처리. 모델에게 돌려줄 tool 결과 텍스트를 만든다."""
    base = (base or "USD").strip().upper()
    quote = (quote or "KRW").strip().upper()
    if not _CURRENCY_RE.match(base) or not _CURRENCY_RE.match(quote):
        return (f"EXCHANGE RATE FAILED — '{base}/{quote}' is not a valid pair of 3-letter "
                "ISO currency codes. Ask the user which currencies they mean.")
    if base == quote:
        return f"1 {base} = 1 {quote} (same currency)."

    key = (base, quote)
    with _exchange_rate_lock:
        hit = _exchange_rate_cache.get(key)
        if hit and time.time() - hit[0] < EXCHANGE_RATE_TTL:
            payload = hit[1]
        else:
            payload = None

    if payload is None:
        errors = []
        for fetch in (_fetch_frankfurter, _fetch_er_api):
            try:
                payload = fetch(base, quote)
                break
            except Exception as e:
                errors.append(f"{fetch.__name__}: {type(e).__name__}: {e}")
        if payload is None:
            print(f"[exchange_rate] FAILED {base}/{quote} :: {' | '.join(errors)}", flush=True)
            return (
                f"EXCHANGE RATE FAILED — could not retrieve {base}/{quote} from any provider.\n\n"
                "Do NOT guess a number and do NOT fall back to web_search (its rates are stale). "
                "Tell the user the rate lookup is down right now and point them to their bank app "
                "or 네이버 금융."
            )
        with _exchange_rate_lock:
            _exchange_rate_cache[key] = (time.time(), payload)

    rate = payload["rate"]
    lines = [f"1 {base} = {rate:,.2f} {quote}"]
    if isinstance(amount, (int, float)) and amount > 0:
        lines.append(f"{amount:,.2f} {base} = {amount * rate:,.2f} {quote}")
    return (
        f"[Exchange rate {base}/{quote}]\n"
        + "\n".join(lines)
        + f"\nReference date: {payload['asof']}\nSource: {payload['source']}\n\n"
        "Use this figure and state the reference date. It is a market mid-rate updated once per "
        "business day, so a bank's 매매기준율 or a cash/card exchange rate will differ slightly — "
        "if the user is actually exchanging money, say so and point them to their bank. "
        "Do NOT call web_search to double-check this."
    )


def run_web_search(query, username=None):
    """web_search 도구 호출 처리. OpenAI 내장 web_search(Responses API)에 위임한다.

    DuckDuckGo는 스니펫만 돌려줘서 서로 다른 시점의 수치가 섞여 들어왔고,
    모델이 "오늘 값"을 특정하지 못했다. 내장 검색은 최신 출처를 직접 읽고
    정리해 주므로 실시간성이 필요한 질문(환율·지수·날씨)에서 훨씬 안정적이다.

    비용이 크므로(요청당 8,000토큰 안팎 + 도구 요금) 플랜별 일일 횟수를 제한하고,
    소비 토큰도 사용자 한도에 합산한다.
    """
    # 1) 일일 검색 횟수 한도
    if username:
        limit = PLAN_CONFIG.get(get_effective_plan(username), PLAN_CONFIG['free'])['search_limit']
        if limit is not None and get_daily_search_count(username) >= limit:
            print(f"[web_search] limit reached user={username} limit={limit}", flush=True)
            return (
                f"WEB SEARCH UNAVAILABLE — the user has used all {limit} web searches allowed today "
                f"on their plan (resets at midnight).\n\n"
                "Do NOT call this tool again in this turn. Tell the user briefly, in their own language, "
                "that today's search limit is used up, then answer from what you already know while "
                "making clear the information may not be current."
            )

    today = datetime.now().strftime("%Y년 %m월 %d일")
    # 날짜를 주입하지 않는다. 검색 도구는 현재 시각을 이미 알고 있고,
    # 우리가 계산한 날짜를 넣으면 "그건 미래 날짜"라며 답을 거부하는 경우가 있다.
    prompt = (
        "다음을 웹에서 찾아 핵심 사실만 간결히 정리해줘.\n\n"
        f"[찾을 것]\n{query}\n\n"
        # 검색 백엔드가 보는 건 실시간 페이지가 아니라 수 주 낡은 크롤 캐시다.
        # investing.com·KRX처럼 숫자를 JS로 그리는 사이트는 캐시에 실시간 값이
        # 텍스트로 없어서, 모델이 페이지에서 읽히는 몇 주 전 종가를 집어다
        # "오늘 약 N원"으로 라벨만 바꿔 내놓는 일이 반복됐다(환율·코스피 모두).
        # 그래서 "값이 없어도 최신 값을 반드시 제시하라"는 지시를 걷어내고,
        # 기준 시점을 밝히도록 강제한다. 정확도는 못 올려도 세탁은 막는다.
        "규칙:\n"
        "1. 수치는 가장 최신 값 하나만 골라, 그 값의 기준 시점(날짜, 가능하면 시각)과 "
        "출처를 반드시 함께 적어.\n"
        "2. 기준 시점이 오늘이 아니면 '현재'·'오늘 기준'이라고 단정하지 마. "
        "'○월 ○일 종가는 N이었고, 그 이후 최신 실시간 값은 확인되지 않았다'처럼 "
        "날짜를 밝혀서 정직하게 적어.\n"
        "3. 페이지에서 실시간 값을 읽어내지 못했으면, 과거 값을 현재값처럼 바꿔 쓰지 말고 "
        "읽지 못했다고 적어. 추정치를 지어내지 마.\n"
        "4. 여러 시점의 값을 나열하지 마.\n"
        f"5. {WEB_SEARCH_MAX_CHARS}자 이내로."
    )
    try:
        resp = openai_client().responses.create(
            model=GPT_CHAT_MODEL,
            input=prompt,
            tools=[{"type": "web_search"}],
            reasoning={"effort": GPT_REASONING_EFFORT},
            # 비용은 출력이 아니라 입력(긁어온 페이지 본문)이 좌우한다. 출력은
            # 어떤 질문이든 200~550토큰으로 고정이라 max_output_tokens는 의미가 없고,
            # 실제 레버는 내부 검색 라운드 수다. 한 번에 못 찾는 질문일수록
            # 라운드를 늘리며 토큰이 폭증해서(실측 최대 40,892) 2회로 묶는다.
            # 조사형 질문은 원래 1~2회라 영향이 없고, 병리 케이스만 잘린다.
            max_tool_calls=2,
        )
    except Exception as e:
        print(f"[web_search] FAILED query={query!r} :: {type(e).__name__}: {e}", flush=True)
        return (
            "WEB SEARCH FAILED — no results were retrieved. "
            f"Reason: {type(e).__name__}: {e}\n\n"
            "Do NOT make up facts to fill the gap. Tell the user in their own language "
            "that the web search is not working right now, then answer from what you "
            "already know while making that limitation explicit."
        )

    # 2) 실제로 검색이 일어났을 때만 횟수·토큰을 집계한다
    searched = any(getattr(o, "type", "") == "web_search_call" for o in (resp.output or []))
    usage = getattr(resp, "usage", None)
    if username:
        if searched:
            add_daily_search_count(username)
        if usage:
            add_daily_tokens(username, getattr(usage, "total_tokens", 0) or 0)

    result = (resp.output_text or "").strip()
    if not result:
        print(f"[web_search] empty result query={query!r} searched={searched}", flush=True)
        return (
            f"WEB SEARCH returned nothing usable for '{query}'. "
            "Say so plainly instead of guessing."
        )
    if len(result) > WEB_SEARCH_MAX_CHARS:
        result = result[:WEB_SEARCH_MAX_CHARS] + "\n…(생략)"

    # 헤더에 "as of {today}"라고만 쓰면, 안에 든 수치가 몇 주 전 값이어도
    # 모델이 결과 전체를 오늘자로 읽는다. 조회 시각과 데이터 기준 시점은 다르다.
    return (
        f"[Web search results for '{query}' — retrieved on {today}]\n{result}\n\n"
        "IMPORTANT: the retrieval date above is NOT the reference time of the figures inside. "
        "If a figure carries an older date, keep that date in your answer and do not restate it "
        "as the current value. If the results only contain a stale figure, say plainly that the "
        "current value could not be confirmed, and suggest where the user can check it directly. "
        "Never invent a fresher-looking number. Otherwise answer from these results, keeping the "
        "source and reference time when they matter, and say plainly if the results do not "
        "actually answer the question."
    )


def roa_gpt_stream(message, messages, username=None, lang='ko', image_hook=None):
    recent = get_recent_messages(messages)
    # 검색은 키워드 매칭이 아니라 모델이 web_search 도구를 호출해서 수행한다.
    recent.append({"role": "user", "content": message})
    today = datetime.now().strftime("%Y년 %m월 %d일")
    system = build_roa_system(lang) + f"\n\n오늘 날짜: {today}. 마크다운 기호(**,##,---)는 쓰지 마."
    if username:
        mem_ctx = vector_memory.build_context_user(username, message)
        if mem_ctx:
            system = mem_ctx + "\n\n" + system

    # OpenAI는 system을 최상위 파라미터가 아니라 첫 메시지로 받는다.
    convo = [{"role": "system", "content": system}] + list(recent)
    parts = []
    tokens = 0
    image_url = None

    for round_idx in range(MAX_TOOL_ROUNDS):
        kwargs = {
            "model": GPT_CHAT_MODEL,
            "max_completion_tokens": 1024,
            "reasoning_effort": GPT_REASONING_EFFORT,
            "messages": convo,
            "stream": True,
            "stream_options": {"include_usage": True},
        }
        # 마지막 라운드에는 도구를 주지 않아 반드시 텍스트로 마무리되게 한다.
        if round_idx < MAX_TOOL_ROUNDS - 1:
            tools = [WEB_SEARCH_TOOL, EXCHANGE_RATE_TOOL]
            # 이미지 생성은 저장·과금 훅이 있어야 동작하므로 훅이 있을 때만 노출한다.
            if image_hook:
                tools.append(GENERATE_IMAGE_TOOL)
            kwargs["tools"] = tools

        round_text = []
        calls = {}          # index -> {"id", "name", "args"}
        finish = None

        for chunk in openai_client().chat.completions.create(**kwargs):
            # usage는 choices가 빈 마지막 청크로 온다 (stream_options 필요)
            usage = getattr(chunk, 'usage', None)
            if usage:
                tokens += usage.total_tokens or 0
            if not chunk.choices:
                continue
            choice = chunk.choices[0]
            if choice.finish_reason:
                finish = choice.finish_reason
            delta = choice.delta
            if delta is None:
                continue

            text = getattr(delta, 'content', None)
            if text:
                round_text.append(text)
                parts.append(text)
                yield (text, None)

            # 함수 인자는 조각으로 나뉘어 오므로 index별로 이어붙여야 한다.
            for tc in (getattr(delta, 'tool_calls', None) or []):
                entry = calls.setdefault(tc.index, {"id": "", "name": "", "args": ""})
                if tc.id:
                    entry["id"] = tc.id
                if tc.function:
                    if tc.function.name:
                        entry["name"] = tc.function.name
                    if tc.function.arguments:
                        entry["args"] += tc.function.arguments

        if finish != 'tool_calls' or not calls:
            break

        ordered = [calls[i] for i in sorted(calls)]
        convo.append({
            "role": "assistant",
            "content": ''.join(round_text) or None,
            "tool_calls": [
                {"id": c["id"], "type": "function",
                 "function": {"name": c["name"], "arguments": c["args"] or "{}"}}
                for c in ordered
            ],
        })
        # 결과는 호출 1건당 role="tool" 메시지 1개로 돌려준다.
        for c in ordered:
            if c["name"] == 'generate_image' and image_hook:
                prompt = _tool_arg(c["args"], "prompt") or message
                saved_url, note = image_hook(prompt)
                if saved_url and image_url is None:
                    image_url = saved_url
            elif c["name"] == 'web_search':
                query = _tool_arg(c["args"], "query") or message
                note = run_web_search(query, username)
            elif c["name"] == 'get_exchange_rate':
                note = run_exchange_rate(
                    _tool_arg(c["args"], "base") or "USD",
                    _tool_arg(c["args"], "quote") or "KRW",
                    _tool_num(c["args"], "amount"),
                )
            else:
                note = f"Unknown tool: {c['name']}"
            convo.append({"role": "tool", "tool_call_id": c["id"], "content": note})

        # 도구 호출 전 텍스트("만들어볼게요")와 이후 답변을 문단으로 분리
        if parts and not ''.join(parts[-2:]).endswith("\n"):
            parts.append("\n\n")
            yield ("\n\n", None)

    yield ('', {'answer': ''.join(parts), 'tokens': tokens, 'image_url': image_url})


def roa_gpt(message, messages, username=None, lang='ko', image_hook=None):
    """비스트리밍 호출. 스트리밍 구현을 그대로 소비해서 동작을 일치시킨다.
    반환: (answer, tokens, image_url_or_None)"""
    final = None
    for _delta, done in roa_gpt_stream(message, messages, username=username, lang=lang, image_hook=image_hook):
        if done is not None:
            final = done
    if final is None:
        return '', 0, None
    return final['answer'], final.get('tokens', 0) or 0, final.get('image_url')


# ============================================
# 이미지 생성 (OpenAI gpt-image-2)
# ============================================
def generate_image_dalle3(prompt):
    response = openai_client().images.generate(
        model="gpt-image-2",
        prompt=prompt,
        size="1024x1024",
        quality="medium",
        n=1,
    )
    if response.data:
        return response.data[0].b64_json
    return None


# ============================================
# 백그라운드 응답 생성
# ============================================
# 사용자 연결(fetch)이 끊겨도 생성이 끝까지 진행되고 세션 파일에 저장되도록,
# 실제 생성은 별도 스레드에서 돌린다. 요청 핸들러는 그 결과를 구독만 한다.
#
# 진실의 원천은 세션 파일의 pending 필드다. 아래 메모리 캐시는 실시간
# partial_text를 넘겨주기 위한 best-effort 보조 저장소일 뿐이라,
# 없어져도 세션 파일만으로 상태 판단이 가능해야 한다.
_generation_status = {}
_generation_guard = threading.Lock()

GENERATION_TTL = 60          # 완료된 작업 상태를 메모리에 남겨두는 시간(초)
PENDING_TOUCH_INTERVAL = 30  # pending.updated 파일 갱신 최소 간격(초)
GENERATION_MAX_WAIT = 300    # 요청 핸들러가 생성 완료를 기다리는 최대 시간(초)
SSE_POLL_INTERVAL = 0.08     # 누적 버퍼를 확인하는 간격(초)


def _gen_key(sid, username):
    return f"{username}/{sid}"


def _gc_generation_status():
    """완료된 지 GENERATION_TTL이 지난 항목 정리."""
    now = time.time()
    with _generation_guard:
        for k, st in list(_generation_status.items()):
            fin = st.get("finished")
            if fin and (now - fin) > GENERATION_TTL:
                _generation_status.pop(k, None)


def get_generation(sid, username):
    return _generation_status.get(_gen_key(sid, username))


def begin_generation(sid, username, message, is_regenerate):
    """활성 작업 확인 → user 메시지 저장 → pending 기록까지를 한 락 안에서 처리.
    반환: (ok, convo_or_None). ok=False면 이미 생성 중이라 거부해야 한다."""
    with get_session_lock(sid, username):
        data = load_session(sid, username)          # stale pending 정리 포함
        if data.get("pending"):
            return False, None

        # 모델에 넘길 이력은 user 메시지를 저장하기 "전" 상태를 쓴다.
        # (roa_gpt_stream이 현재 message를 스스로 덧붙이므로)
        prior = list(data.get("messages", []))
        convo = strip_last_exchange(prior, message) if is_regenerate else prior

        if not is_regenerate:
            add_to_session(sid, "user", message, username)

        data = load_session(sid, username)
        now = time.time()
        data["pending"] = {
            "kind": "regenerate" if is_regenerate else "chat",
            "started": now,
            "updated": now,
        }
        save_session(sid, data, username)

    with _generation_guard:
        _generation_status[_gen_key(sid, username)] = {
            "status": "generating",
            "kind": "regenerate" if is_regenerate else "chat",
            "partial": "",
            "answer": None,
            "image_url": None,
            "error": None,
            "started": time.time(),
            "finished": None,
        }
    return True, convo


def _touch_pending(sid, username):
    """긴 생성이 stale로 오판되지 않게 pending.updated를 갱신한다."""
    with get_session_lock(sid, username):
        data = load_session(sid, username)
        pending = data.get("pending")
        if not pending:
            return
        pending["updated"] = time.time()
        save_session(sid, data, username)


def finalize_generation(sid, username, answer, is_regenerate, image_url=None):
    """구 답변 pop + 새 답변 append + pending 제거를 한 락 안에서 원자적으로.
    pop만 되고 저장이 실패하는 상황을 만들지 않는다."""
    with get_session_lock(sid, username):
        data = load_session(sid, username)
        msgs = data.setdefault("messages", [])
        if is_regenerate:
            for i in range(len(msgs) - 1, -1, -1):
                if msgs[i].get("role") == "assistant":
                    removed = msgs.pop(i)
                    # 폐기되는 답변이 이미지를 갖고 있었다면 파일도 함께 지운다
                    delete_generated_images(username, [removed])
                    break
        entry = {
            "role": "assistant",
            "content": answer,
            "time": datetime.now().strftime("%Y-%m-%d %H:%M"),
            # 스트리밍 답변은 질문 텍스트만으로 다시 만들 수 있다.
            # 교체 때마다 명시적으로 다시 넣어야 재생성 2회째부터 플래그가 사라지지 않는다.
            "regenerable": True,
        }
        if image_url:
            entry["generatedImage"] = image_url
        msgs.append(entry)
        data.pop("pending", None)
        save_session(sid, data, username)


def replace_last_answer(sid, username, answer):
    """재생성 결과를 세션에 반영한다: 마지막 assistant 답변을 새 답변으로 교체.

    user 메시지는 이미 세션에 있으므로 다시 넣지 않는다 — 그냥 append하면
    같은 질문이 두 벌 쌓인다. finalize_generation(is_regenerate=True)과 같은
    규약이며, 스트리밍을 쓰지 않는 라우트(/api/youtube 등)가 쓴다.
    pop과 append를 한 락 안에서 처리해 중간 상태가 저장되지 않게 한다.
    """
    with get_session_lock(sid, username):
        data = load_session(sid, username)
        msgs = data.setdefault("messages", [])
        for i in range(len(msgs) - 1, -1, -1):
            if msgs[i].get("role") == "assistant":
                delete_generated_images(username, [msgs.pop(i)])
                break
        msgs.append({
            "role": "assistant",
            "content": answer,
            "time": datetime.now().strftime("%Y-%m-%d %H:%M"),
            # 교체본에도 다시 넣는다 (연속 재생성에서 플래그가 유실되지 않게)
            "regenerable": True,
        })
        save_session(sid, data, username)


def fail_generation(sid, username, error_msg, is_regenerate):
    """실패 처리. pending을 지우고, 일반 대화면 에러 답변을 남겨
    'user 메시지만 있고 답이 없는' 상태를 만들지 않는다.
    재생성 실패는 기존 답변을 그대로 보존한다."""
    with get_session_lock(sid, username):
        data = load_session(sid, username)
        data.pop("pending", None)
        if not is_regenerate:
            data.setdefault("messages", []).append({
                "role": "assistant",
                "content": f"오류가 발생했어요. ({error_msg})",
                "time": datetime.now().strftime("%Y-%m-%d %H:%M"),
                "regenerable": True,   # 실패한 턴이야말로 다시 시도할 수 있어야 한다
            })
        save_session(sid, data, username)


def _make_image_hook(username, user_plan, state):
    """Claude가 generate_image 도구를 호출했을 때 실행.
    반환: (b64 이미지 or None, Claude에게 돌려줄 tool_result 텍스트)
    실패도 tool_result로 알려서 Claude가 자연스럽게 사과/재안내하게 한다."""
    def image_hook(prompt):
        image_limit = PLAN_CONFIG.get(user_plan, PLAN_CONFIG['free'])['image_limit']
        if image_limit is not None and get_daily_image_count(username) >= image_limit:
            return None, (
                f"Image generation was refused: the user has already used all {image_limit} image generations "
                f"allowed for today on their current plan. Tell them in their own language that the daily "
                f"limit is reached and that it resets at midnight. Do not call the tool again."
            )
        try:
            b64 = generate_image_dalle3(prompt)
        except Exception as e:
            print(f"[generate_image] failed: {e}")
            return None, (
                f"Image generation failed with an error: {e}. Tell the user the image could not be created "
                f"right now, in their own language, and offer to try again or adjust the request. "
                f"Do not call the tool again in this turn."
            )
        if not b64:
            return None, (
                "Image generation returned no image. Tell the user it failed, in their own language, and offer "
                "to try again with a different description. Do not call the tool again in this turn."
            )
        add_daily_image_count(username)
        try:
            image_url = save_generated_image(username, b64)
        except Exception as e:
            print(f"[generate_image] save failed: {e}")
            return None, (
                f"The image was generated but saving it failed: {e}. Tell the user it could not be delivered "
                f"right now, in their own language, and offer to try again. Do not call the tool again in this turn."
            )
        if state.get("image_url") is None:
            state["image_url"] = image_url
        return image_url, (
            "The image was generated successfully and is already displayed to the user. Briefly tell them it is "
            "ready, in their own language. Do not describe the image in detail and do not repeat the English prompt."
        )
    return image_hook


def _run_generation(username, sid, message, convo, lang, is_regenerate, user_plan):
    """백그라운드 스레드 본체. Flask request/g를 절대 참조하지 않고
    호출 전에 복사된 값만 사용한다."""
    key = _gen_key(sid, username)
    state = _generation_status.get(key)
    if state is None:
        return
    last_touch = time.time()

    try:
        final = None
        image_hook = _make_image_hook(username, user_plan, state)
        for delta, done in roa_gpt_stream(message, convo, username=username,
                                             lang=lang, image_hook=image_hook):
            if done is None:
                if delta:
                    state["partial"] += delta
                # 도구 호출 등으로 생성이 길어져도 stale로 오판되지 않게 갱신.
                # 델타마다 쓰면 파일 I/O가 폭증하므로 간격을 둔다.
                if (time.time() - last_touch) > PENDING_TOUCH_INTERVAL:
                    last_touch = time.time()
                    try:
                        _touch_pending(sid, username)
                    except Exception as e:
                        print(f"[generation] touch_pending failed (sid={sid}): {e}")
                continue
            final = done

        if final is None:
            raise RuntimeError("no response")

        answer = final.get("answer") or ""
        add_daily_tokens(username, final.get("tokens", 0) or 0)
        if final.get("image_url") and state.get("image_url") is None:
            state["image_url"] = final["image_url"]

        finalize_generation(sid, username, answer, is_regenerate, state.get("image_url"))

        # 세션 저장이 끝나는 즉시 완료로 표시한다.
        # 아래 장기기억 저장은 임베딩 API 왕복이라 수 초가 걸릴 수 있는데,
        # 그동안 "pending은 이미 없는데 status는 아직 generating"인 어중간한
        # 상태가 되면 상태 조회가 생성 이미지를 빠뜨린 채 idle로 응답해버린다.
        state["answer"] = answer
        state["status"] = "done"
        state["finished"] = time.time()

        # 완료 표시 뒤에 진행 — 실패하거나 느려도 사용자 응답에는 영향이 없다.
        try:
            if not is_regenerate:
                vector_memory.save_user(username, "user", message, session_id=sid or "")
            vector_memory.save_user(username, "assistant", answer, session_id=sid or "")
        except Exception as e:
            print(f"[vector_memory] save_user failed (sid={sid}): {e}")
    except Exception as e:
        error_msg = str(e)
        print(f"[generation] failed (sid={sid}): {error_msg}")
        try:
            fail_generation(sid, username, error_msg, is_regenerate)
        except Exception as e2:
            print(f"[generation] fail_generation also failed (sid={sid}): {e2}")
        state["error"] = error_msg
        state["status"] = "error"
        state["finished"] = time.time()
    finally:
        _gc_generation_status()


def spawn_generation(username, sid, message, convo, lang, is_regenerate, user_plan):
    t = threading.Thread(
        target=_run_generation,
        args=(username, sid, message, list(convo), lang, is_regenerate, user_plan),
        name=f"gen-{sid}",
        daemon=False,
    )
    t.start()
    return t

# ============================================
# PDF 분석
# ============================================
def analyze_pdf(file_path, question):
    """반환: (답변, 소비 토큰). 호출자가 add_daily_tokens로 집계한다."""
    try:
        import base64
        try:
            import pymupdf as fitz
        except ImportError:
            import fitz

        doc = fitz.open(file_path)
        pages_text = []
        image_pages = []  # (page_index, base64_png) for text-less pages
        for i, page in enumerate(doc):
            page_text = page.get_text().strip()
            if page_text:
                pages_text.append(page_text)
            else:
                pix = page.get_pixmap(dpi=150)
                b64 = base64.standard_b64encode(pix.tobytes("png")).decode()
                image_pages.append(b64)
        doc.close()

        text = "\n\n".join(pages_text)
        has_text = bool(text.strip())
        has_images = bool(image_pages)

        # 텍스트만 있는 경우
        if has_text and not has_images:
            prompt = f"다음 문서를 읽고 질문에 답해줘.\n\n[문서]\n{text[:10000]}\n\n[질문]\n{question}"
            answer, tokens = gpt_complete(prompt)
            return answer, tokens

        # 이미지 페이지가 있는 경우 → 멀티모달로 함께 전달
        content_blocks = []
        if has_text:
            content_blocks.append({
                "type": "text",
                "text": f"[텍스트 페이지]\n{text[:5000]}\n\n"
            })
        for b64 in image_pages[:10]:  # 최대 10페이지
            content_blocks.append(gpt_image_part(b64, "image/png"))
        content_blocks.append({
            "type": "text",
            "text": f"위 문서(텍스트 및 이미지 페이지 포함)를 읽고 질문에 답해줘.\n\n[질문]\n{question}"
        })
        answer, tokens = gpt_complete(content_blocks)
        return answer, tokens
    except Exception as e:
        return f"PDF 오류: {e}", 0

# ============================================
# 유튜브 분석
# ============================================
def _youtube_transcript(video_id, lang='ko'):
    """유튜브 자막을 (텍스트, 사용된 언어코드)로 반환. 실패하면 예외를 올린다.

    언어를 고정 목록으로 요청하면 그 목록에 없는 자막만 가진 영상이 통째로
    실패한다(일본어·스페인어 전용 영상 등). 그래서 list()로 실제 있는 자막을
    먼저 확인한 뒤 우선순위대로 고른다:
      1) 사용자 UI 언어  2) 그 반대(ko↔en)  3) 남은 아무 언어
    같은 순위 안에서는 자동생성보다 수동 자막을 먼저 쓴다(정확도가 높다).

    답변 언어는 프롬프트가 따로 정하므로 자막 언어와 일치할 필요는 없다.
    일본어 자막만 있어도 한국어로 요약해 준다.

    youtube-transcript-api 1.0에서 클래스 메서드 get_transcript()가 없어지고
    인스턴스 메서드 fetch()로 바뀌었다. 두 버전 모두에서 동작하도록 분기한다.
    """
    from youtube_transcript_api import YouTubeTranscriptApi

    def join(snippets):
        return " ".join((s.text if hasattr(s, 'text') else s['text']) for s in snippets)

    if not hasattr(YouTubeTranscriptApi, 'fetch'):      # 0.x — list 기반 선택 불가
        rows = YouTubeTranscriptApi.get_transcript(video_id, languages=[lang, 'en', 'ko'])
        return join(rows), lang

    api = YouTubeTranscriptApi()
    available = list(api.list(video_id))
    if not available:
        raise ValueError(f"no transcripts listed for {video_id}")

    prefer = [lang, 'en' if lang != 'en' else 'ko']

    def rank(t):
        base = (t.language_code or '').split('-')[0].lower()
        lang_rank = prefer.index(base) if base in prefer else len(prefer)
        return (lang_rank, 1 if t.is_generated else 0)

    chosen = sorted(available, key=rank)[0]
    fetched = chosen.fetch()
    return join(getattr(fetched, 'snippets', fetched)), chosen.language_code


# 자막 라이브러리 예외를 사용자에게 보여줄 한 줄로 바꾼다.
# 원문에는 GitHub 이슈 안내문까지 들어 있어 그대로 노출하면 안 된다(로그에만 남긴다).
_TRANSCRIPT_REASONS = {
    'TranscriptsDisabled': '이 영상은 자막이 꺼져 있어요.',
    'NoTranscriptFound':   '한국어·영어 자막이 없어요.',
    'NoTranscriptAvailable': '사용할 수 있는 자막이 없어요.',
    'VideoUnavailable':    '영상을 찾을 수 없어요(비공개·삭제·지역 제한).',
    'AgeRestricted':       '연령 제한 영상이라 자막을 가져올 수 없어요.',
    'VideoUnplayable':     '재생할 수 없는 영상이에요.',
    'IpBlocked':           '유튜브가 서버 IP를 차단했어요.',
    'RequestBlocked':      '유튜브가 서버에서의 자막 요청을 차단했어요.',
    'AttributeError':      '자막 라이브러리 버전이 맞지 않아요(서버 설정 문제).',
}


_YT_HOSTS = ('youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be')
_YT_ID_RE = re.compile(r'^[A-Za-z0-9_-]{5,20}$')


def _youtube_video_id(url):
    """유튜브 URL에서 video_id를 뽑는다. 유튜브 호스트가 아니거나 형식이 다르면 None.

    호스트를 검증하지 않으면 사용자가 넘긴 임의 URL을 yt-dlp가 그대로 내려받아
    서버가 내부망 등 아무 주소나 요청하는 SSRF가 된다. 이후 다운로드도 원본 url이
    아니라 여기서 뽑은 id로 재구성한 표준 URL만 쓴다.
    """
    import urllib.parse
    if not isinstance(url, str):
        return None
    parsed = urllib.parse.urlparse(url.strip())
    host = (parsed.hostname or '').lower()
    if parsed.scheme not in ('http', 'https') or host not in _YT_HOSTS:
        return None
    if host == 'youtu.be':
        vid = parsed.path.lstrip('/').split('/')[0]
    else:
        vid = urllib.parse.parse_qs(parsed.query).get('v', [None])[0]
        if not vid:
            for prefix in ('/shorts/', '/live/', '/embed/'):
                if parsed.path.startswith(prefix):
                    vid = parsed.path[len(prefix):].split('/')[0]
                    break
    return vid if vid and _YT_ID_RE.match(vid) else None


def analyze_youtube(url, question, lang='ko'):
    """반환: (답변, 소비 토큰)."""
    try:
        video_id = _youtube_video_id(url)
        if not video_id:
            return "유튜브 URL이 올바르지 않아요!", 0
        # 이후 모든 접근은 검증된 id로 만든 표준 URL만 사용한다 (SSRF 방지)
        url = f"https://www.youtube.com/watch?v={video_id}"

        # 1단계: 자막 API (텍스트만, 빠르고 저렴 — 자막이 있으면 여기서 끝난다)
        try:
            text, tr_lang = _youtube_transcript(video_id, lang=lang)
            if text.strip():
                print(f"[youtube] transcript OK video_id={video_id} lang={tr_lang} chars={len(text)}", flush=True)
                # 자막 언어를 알려줘야 모델이 필요할 때 번역해서 답할 수 있다.
                prompt = (f"다음 유튜브 영상 자막({tr_lang})을 읽고 질문에 답해줘.\n\n"
                          f"[자막]\n{text[:10000]}\n\n[질문]\n{question}")
                answer, tokens = gpt_complete(prompt, system=build_roa_system(lang))
                return answer, tokens
            transcript_err = "자막 내용이 비어 있어요."
            print(f"[youtube] transcript empty video_id={video_id}", flush=True)
        except Exception as e1:
            # 예전에는 이 예외를 통째로 삼켜서 실패 원인이 어디에도 남지 않았다.
            name = type(e1).__name__
            transcript_err = _TRANSCRIPT_REASONS.get(name, '자막을 가져오지 못했어요.')
            print(f"[youtube] transcript FAILED video_id={video_id} :: {name}: {e1}", flush=True)

        # 2단계: yt-dlp로 영상 다운 → analyze_video 파이프라인 (음성+프레임)
        try:
            import yt_dlp
            with tempfile.TemporaryDirectory() as tmpdir:
                ydl_opts = {
                            'format': 'best[height<=480]/best',
                            'outtmpl': f'{tmpdir}/video.%(ext)s',
                            'quiet': True,
                }
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    info = ydl.extract_info(url, download=True)
                    title = info.get('title', '')

                video_files = [f for f in os.listdir(tmpdir) if f.startswith('video.')]
                if not video_files:
                    raise Exception("다운로드 실패")

                video_path = os.path.join(tmpdir, video_files[0])
                full_question = f"{question}\n\n(영상 제목: {title})" if title else question
                return analyze_video(video_path, full_question)
        except Exception as e2:
            download_err = f"{type(e2).__name__}: {e2}"
            print(f"[youtube] download FAILED video_id={video_id} :: {download_err}", flush=True)

            # 3단계: YouTube Data API 폴백 (제목/설명만)
            try:
                api_key = os.getenv("YOUTUBE_API_KEY")
                if api_key:
                    video_url = f"https://www.googleapis.com/youtube/v3/videos?part=snippet&id={video_id}&key={api_key}"
                    video_res = requests.get(video_url, timeout=10).json()
                    if video_res.get('items'):
                        item = video_res['items'][0]['snippet']
                        text = f"제목: {item['title']}\n설명: {item['description']}"
                        prompt = f"다음 유튜브 영상 정보를 바탕으로 질문에 답해줘.\n\n{text}\n\n[질문]\n{question}"
                        answer, tokens = gpt_complete(prompt, max_tokens=1024)
                        return answer + "\n\n(⚠️ 자막과 영상을 못 가져와서 제목·설명만 보고 답한 내용이에요.)", tokens
                else:
                    print("[youtube] YOUTUBE_API_KEY 없음 — 3단계 폴백 건너뜀", flush=True)
            except Exception as e3:
                print(f"[youtube] data API FAILED video_id={video_id} :: {type(e3).__name__}: {e3}", flush=True)

            # 전부 실패. 사용자에게는 원인별로 다르게 안내한다.
            # 예전 메시지("자막 없음, 다운로드 오류")는 자막이 실제로 있는 영상에서도
            # 그대로 나와서 원인을 오해하게 만들었다.
            blocked = '403' in download_err or 'Forbidden' in download_err
            if blocked:
                reason = ("유튜브가 서버에서의 영상 다운로드를 차단했어요(403). "
                          "서버 IP가 자동 프로그램으로 오인된 경우라 잠시 뒤에도 같을 수 있어요.")
            else:
                reason = "영상을 가져오는 데 실패했어요."
            return (
                f"이 영상은 분석하지 못했어요.\n\n"
                f"· 자막: {transcript_err}\n"
                f"· 영상: {reason}\n\n"
                "자막이 있는 영상은 대부분 바로 분석되니 다른 영상으로 시도해 보시거나, "
                "영상 파일을 직접 첨부해 주시면 그대로 분석해 드릴게요."
            ), 0
    except Exception as e:
        return f"유튜브 분석 오류: {e}", 0

# ============================================
# 영상 파일 분석 (음성 + 프레임 동적 추출)
# ============================================
def analyze_video(file_path, question):
    """반환: (답변, 소비 토큰). Whisper 사용분은 토큰으로 환산해 합산한다."""
    import subprocess
    import base64
    try:

        # 파일 크기 제한 50MB
        if os.path.getsize(file_path) > 50 * 1024 * 1024:
            return "영상 파일이 너무 커요. 50MB 이하 영상만 분석 가능해요.", 0

        with tempfile.TemporaryDirectory() as tmpdir:
            # 1. 영상 길이 파악 (ffprobe)
            probe = subprocess.run(
                ["ffprobe", "-v", "error", "-show_entries", "format=duration",
                 "-of", "default=noprint_wrappers=1:nokey=1", file_path],
                capture_output=True, text=True
            )
            try:
                duration = float(probe.stdout.strip())
            except:
                duration = 60  # 파악 실패시 1분으로 가정

            # 2. 모델에 넘길 최대 프레임 수
            model_max = MAX_VIDEO_FRAMES

            # 3. 영상 길이별 적정 프레임 수 (모델 한도 초과 안 하게)
            if duration <= 60:
                target_frames = min(8, model_max)
            elif duration <= 300:
                target_frames = min(15, model_max)
            else:
                target_frames = min(20, model_max)

            # 4. 균등 간격으로 프레임 추출 (fps 대신 select 필터로 정확하게)
            interval = duration / target_frames
            frames_dir = os.path.join(tmpdir, "frames")
            os.makedirs(frames_dir, exist_ok=True)
            subprocess.run(
                ["ffmpeg", "-i", file_path,
                 "-vf", f"select='not(mod(n\\,{max(1, int(interval * 30))}))',scale=854:480",
                 "-vsync", "vfr", "-frames:v", str(target_frames),
                 os.path.join(frames_dir, "frame%03d.jpg"), "-y"],
                capture_output=True, text=True, timeout=180
            )
            frame_files = sorted([
                os.path.join(frames_dir, f) for f in os.listdir(frames_dir) if f.endswith(".jpg")
            ])[:target_frames]

            # 5. 오디오 → Whisper 텍스트 변환
            audio_path = os.path.join(tmpdir, "audio.mp3")
            subprocess.run(
                ["ffmpeg", "-i", file_path, "-vn", "-ar", "16000", "-ac", "1", "-b:a", "64k", audio_path, "-y"],
                capture_output=True, text=True, timeout=180
            )
            transcript_text = ""
            audio_tokens = 0
            if os.path.exists(audio_path):
                # Whisper는 분당 과금이라 토큰 한도에 환산해서 얹는다
                audio_seconds = probe_media_seconds(audio_path)
                with open(audio_path, "rb") as f:
                    transcript = openai_client().audio.transcriptions.create(
                        model="whisper-1", file=f
                    )
                transcript_text = transcript.text
                # 전사가 실제로 이뤄진 뒤에만 집계
                if transcript_text.strip():
                    audio_tokens = whisper_tokens(audio_seconds)

            # 6. 프레임 base64 인코딩
            frames_b64 = []
            for fp in frame_files:
                with open(fp, "rb") as f:
                    frames_b64.append(base64.b64encode(f.read()).decode("utf-8"))

            if not transcript_text and not frames_b64:
                return "영상에서 내용을 추출할 수 없어요. 파일을 확인해주세요.", 0

            audio_part = f"[음성 내용]\n{transcript_text[:8000]}" if transcript_text else "[음성 없음]"
            prompt = (
                f"영상을 분석해줘. 추출된 프레임 {len(frames_b64)}장과 음성을 종합해서 답해줘.\n"
                f"영상 길이: 약 {int(duration)}초\n\n{audio_part}\n\n[질문]\n{question}"
            )

            # 7. 프레임 + 음성 전사를 함께 넘겨 분석
            content = [gpt_image_part(b64, "image/jpeg", detail="low") for b64 in frames_b64]
            content.append({"type": "text", "text": prompt})
            answer, tokens = gpt_complete(content)
            return answer, tokens + audio_tokens

    except subprocess.TimeoutExpired:
        return "영상 분석 시간이 초과됐어요. 더 짧거나 작은 영상으로 시도해줘요.", 0
    except Exception as e:
        return f"영상 분석 오류: {e}", 0


@app.route('/privacy')
def privacy():
    return send_from_directory('static/react', 'index.html')

@app.route('/terms')
def terms():
    return send_from_directory('static/react', 'index.html')

# ── 관리자용 수동 Pro 부여 ───────────────────────────────────────
MANUAL_GRANT_MARKER = 'manual_grant'
MANUAL_GRANT_FOREVER = '9999-12-31'   # 만료 없는 부여의 next_billing_date


def grant_manual_pro(username, days=None, plan='ai'):
    """지정 사용자에게 관리자용 Pro 이용 기간을 부여한다.

    - username == ROA_USERNAME(기본 관리자)이거나 없는 사용자면 ValueError.
      → 기본 관리자 계정 데이터는 절대 건드리지 않는다.
    - days=None이면 만료 없음(next_billing_date=9999-12-31).
    - days 지정이면 만료일을 저장하고, 날짜가 지나면 자동으로 Free가 된다.
    반환: 부여 결과 dict.
    """
    if not username or username == ROA_USERNAME:
        raise ValueError("기본 관리자 계정에는 수동 부여할 수 없습니다.")
    if not get_user(username):
        raise ValueError(f"존재하지 않는 사용자입니다: {username}")
    if plan not in ('ai', 'magen', 'bundle'):
        raise ValueError("알 수 없는 Pro 부여 플랜입니다.")
    if days is not None and days <= 0:
        raise ValueError("days는 1 이상이어야 합니다.")

    now = datetime.now()
    if days is None:
        status, next_billing = 'active', MANUAL_GRANT_FOREVER
    else:
        status, next_billing = 'canceled', (now + timedelta(days=days)).strftime('%Y-%m-%d')
    now_iso = now.isoformat()

    con = sqlite3.connect(DB_FILE)
    try:
        con.execute("""
            INSERT INTO subscriptions
                (username, plan, amount, billing_key, customer_key,
                 card_company, card_number_masked, status, next_billing_date,
                created_at, updated_at)
            VALUES (?, ?, 0, '', '', ?, 'MANUAL', ?, ?, ?, ?)
            ON CONFLICT(username, plan) DO UPDATE SET
                amount=0,
                billing_key='',
                customer_key='',
                card_company=excluded.card_company,
                card_number_masked='MANUAL',
                status=excluded.status,
                next_billing_date=excluded.next_billing_date,
                updated_at=excluded.updated_at
        """, (username, plan, MANUAL_GRANT_MARKER, status, next_billing, now_iso, now_iso))
        con.commit()
    finally:
        con.close()

    return {
        "username": username, "plan": plan, "status": status,
        "next_billing_date": next_billing, "billing_key": "", "amount": 0,
        "manual_grant": True,
    }


@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def index(path):
    if path.startswith('api/'):
        return jsonify({"success": False, "error": "요청한 경로를 찾을 수 없습니다."}), 404

    host = (request.host or '').split(':')[0].lower()
    if host in APP_HOSTS:
        return send_from_directory('static/react', 'index.html')
    if host in LANDING_HOSTS:
        return render_template('home.html')

    if path == '' and not session.get('logged_in'):
        return render_template('home.html')
    return send_from_directory('static/react', 'index.html')

@app.route('/api/check-username', methods=['GET'])
def check_username():
    username = (request.args.get('username') or '').strip()
    if not username:
        return jsonify({"available": False, "error": "아이디를 입력해주세요."})
    fmt_err = _username_error(username)
    if fmt_err:
        return jsonify({"available": False, "error": fmt_err})
    if username == ROA_USERNAME or get_user(username):
        return jsonify({"available": False, "error": "이미 사용 중인 아이디입니다."})
    return jsonify({"available": True})


@app.route('/api/register', methods=['POST'])
def register():
    data = request.get_json(silent=True) or {}
    username = str(data.get('username') or '').strip()
    password = str(data.get('password') or '').strip()
    email = str(data.get('email') or '').strip()

    if not username or not password or not email:
        return jsonify({"success": False, "error": "모든 필드를 입력해주세요."})
    fmt_err = _username_error(username)
    if fmt_err:
        return jsonify({"success": False, "error": fmt_err})
    if not EMAIL_RE.match(email) or len(email) > 254:
        return jsonify({"success": False, "error": "이메일 형식이 올바르지 않습니다."})
    if len(password) < 8:
        return jsonify({"success": False, "error": "비밀번호는 8자 이상이어야 합니다."})
    if not PW_REGEX.match(password):
        return jsonify({"success": False, "error": "비밀번호는 영문+숫자+특수문자를 포함해야 합니다."})

    if username == ROA_USERNAME or get_user(username):
        return jsonify({"success": False, "error": "이미 사용 중인 아이디입니다."})

    if not _mail_cooldown_ok(get_client_ip()):
        return jsonify({"success": False, "error": "요청이 너무 잦아요. 잠시 후 다시 시도해주세요."}), 429

    code = str(secrets.randbelow(1000000)).zfill(6)
    con = sqlite3.connect(DB_FILE)
    con.execute(
        "INSERT OR REPLACE INTO pending_users (username, password_hash, email, code, expires) VALUES (?, ?, ?, ?, ?)",
        (username, hash_password(password), email, code, time.time() + 600)
    )
    con.commit()
    con.close()

    smtp_email = os.getenv("SMTP_EMAIL")
    smtp_password = os.getenv("SMTP_PASSWORD")
    if not smtp_email or not smtp_password:
        return jsonify({"success": False, "error": "이메일 발송 설정이 없습니다. (SMTP_EMAIL, SMTP_PASSWORD 환경변수 필요)"})

    try:
        msg = MIMEMultipart()
        # 로그인은 smtp_email, 표시 주소는 SMTP_FROM (스팸 분류 완화)
        msg['From'] = SMTP_FROM
        msg['To'] = email
        msg['Subject'] = Header('Roa 이메일 인증 코드', 'utf-8')
        body = MIMEText(f'인증 코드: {code}\n\n5분 안에 입력해주세요.', 'plain', 'utf-8')
        msg.attach(body)
        with smtplib.SMTP_SSL('smtp.gmail.com', 465) as server:
            server.login(smtp_email, smtp_password)
            server.send_message(msg)
    except Exception as e:
        print(f"[register] mail failed: {type(e).__name__}: {e}", flush=True)
        return jsonify({"success": False, "error": "인증 메일 발송에 실패했어요. 잠시 후 다시 시도해주세요."})

    return jsonify({"success": True, "message": "인증 코드가 이메일로 발송되었습니다."})


# 이메일 인증·비밀번호 재설정 코드의 무차별 대입 방어.
# 틀릴 때마다 attempts를 올리고, 한도를 넘으면 코드 행을 폐기해 재발급을 강제한다.
MAX_CODE_ATTEMPTS = 5


def _register_code_failure(con, table, key_col, key_val, prev_attempts):
    """실패 1회 반영. 남은 시도 횟수를 반환(0 이하면 방금 폐기됨)."""
    attempts = (prev_attempts or 0) + 1
    if attempts >= MAX_CODE_ATTEMPTS:
        con.execute(f"DELETE FROM {table} WHERE {key_col} = ?", (key_val,))
        return 0
    con.execute(f"UPDATE {table} SET attempts = ? WHERE {key_col} = ?", (attempts, key_val))
    return MAX_CODE_ATTEMPTS - attempts


@app.route('/api/verify-email', methods=['POST'])
def verify_email():
    data = request.get_json(silent=True) or {}
    username = str(data.get('username') or '').strip()
    code = str(data.get('code') or '').strip()

    con = sqlite3.connect(DB_FILE)
    con.row_factory = sqlite3.Row
    pending = con.execute(
        "SELECT * FROM pending_users WHERE username = ?", (username,)
    ).fetchone()
    con.close()

    if not pending:
        return jsonify({"success": False, "error": "가입 정보가 없습니다. 다시 시도해주세요."})
    if time.time() > pending['expires']:
        con = sqlite3.connect(DB_FILE)
        con.execute("DELETE FROM pending_users WHERE username = ?", (username,))
        con.commit()
        con.close()
        return jsonify({"success": False, "error": "인증 코드가 만료되었습니다."})
    if not hmac.compare_digest(pending['code'], code):
        # 틀린 코드를 세지 않으면 만료 전까지 무제한 대입이 가능하다.
        # MAX_CODE_ATTEMPTS회를 넘기면 코드를 폐기해 새 발급을 강제한다.
        con = sqlite3.connect(DB_FILE)
        left = _register_code_failure(con, 'pending_users', 'username', username, pending['attempts'])
        con.commit(); con.close()
        if left <= 0:
            return jsonify({"success": False, "error": "인증 코드를 너무 많이 틀렸어요. 코드를 다시 요청해주세요."})
        return jsonify({"success": False, "error": f"인증 코드가 맞지 않습니다. ({left}회 남음)"})

    # 같은 username으로 이전에 탈퇴/사용 흔적이 남아 있으면 자동 삭제 후 새로 시작
    # (sessions/{username}/, planners/{username}.json, vector memory)
    purge_user_files(username)

    create_user_full(username, pending['password_hash'], pending['email'])
    con = sqlite3.connect(DB_FILE)
    con.execute("DELETE FROM pending_users WHERE username = ?", (username,))
    con.commit()
    con.close()
    return jsonify({"success": True, "message": "회원가입이 완료되었습니다."})


def _send_mail(to_email, subject, body_text):
    """일반 텍스트 메일 1통 발송. 실패하면 예외를 올린다(호출부가 처리)."""
    smtp_email = os.getenv("SMTP_EMAIL")
    smtp_password = os.getenv("SMTP_PASSWORD")
    if not smtp_email or not smtp_password:
        raise RuntimeError("SMTP 미설정 (SMTP_EMAIL/SMTP_PASSWORD)")
    msg = MIMEMultipart()
    # 로그인은 smtp_email, 표시 주소는 SMTP_FROM (스팸 분류 완화)
    msg['From'] = SMTP_FROM
    msg['To'] = to_email
    msg['Subject'] = Header(subject, 'utf-8')
    msg.attach(MIMEText(body_text, 'plain', 'utf-8'))
    with smtplib.SMTP_SSL('smtp.gmail.com', 465) as server:
        server.login(smtp_email, smtp_password)
        server.send_message(msg)


# 아이디 찾기·비번 찾기 공통 응답. 이메일/계정 존재 여부와 무관하게 항상 같은
# 문구를 돌려주고, 실제 발송 실패도 로그만 남겨 계정 열거를 막는다.
_FIND_ID_MSG = "입력하신 이메일로 가입된 아이디가 있으면 메일로 보내드렸어요."
_RESET_SENT_MSG = "입력하신 정보가 일치하면 재설정 메일을 보내드렸어요."


@app.route('/api/find-username', methods=['POST'])
def find_username():
    """이메일로 가입된 아이디(들)를 메일로 발송. 화면에는 노출하지 않는다."""
    data = request.get_json(silent=True) or {}
    email = str(data.get('email') or '').strip().lower()
    if not email:
        return jsonify({"success": False, "error": "이메일을 입력해주세요."})

    # 계정 조회 전에 쿨다운을 확인한다(존재 여부와 무관한 동일 응답 → 열거 방지).
    if not _mail_cooldown_ok(get_client_ip()):
        return jsonify({"success": False, "error": "요청이 너무 잦아요. 잠시 후 다시 시도해주세요."}), 429

    con = sqlite3.connect(DB_FILE)
    rows = con.execute(
        "SELECT username FROM users WHERE LOWER(email) = ? ORDER BY username", (email,)
    ).fetchall()
    con.close()

    if rows:
        usernames = [r[0] for r in rows]
        listed = "\n".join(f"- {u}" for u in usernames)
        body = (f"입력하신 이메일로 가입된 아이디는 다음과 같아요.\n\n{listed}\n\n"
                "로그인 화면에서 사용해주세요.\n\n본인이 요청하지 않았다면 이 메일을 무시하세요.")
        try:
            _send_mail(email, 'Roa 아이디 안내', body)
        except Exception as e:
            print(f"[find_username] mail failed for {email}: {e}", flush=True)

    # 존재 여부와 무관하게 항상 동일 응답 (열거 방지)
    return jsonify({"success": True, "message": _FIND_ID_MSG})


@app.route('/api/forgot-password', methods=['POST'])
def forgot_password():
    data = request.get_json(silent=True) or {}
    username = str(data.get('username') or '').strip()
    email = str(data.get('email') or '').strip().lower()
    if not username or not email:
        return jsonify({"success": False, "error": "아이디와 이메일을 모두 입력해주세요."})

    # 계정 조회 전에 쿨다운을 확인한다(일치 여부와 무관한 동일 응답 → 열거 방지).
    if not _mail_cooldown_ok(get_client_ip()):
        return jsonify({"success": False, "error": "요청이 너무 잦아요. 잠시 후 다시 시도해주세요."}), 429

    # 아이디-이메일이 실제로 같은 계정인지 확인. 일치할 때만 코드를 발송한다.
    con = sqlite3.connect(DB_FILE)
    row = con.execute(
        "SELECT 1 FROM users WHERE username = ? AND LOWER(email) = ?", (username, email)
    ).fetchone()
    if row:
        code = str(secrets.randbelow(1000000)).zfill(6)
        # pending_reset PK는 email. 같은 이메일로 재요청하면 이전 코드를 덮는다.
        con.execute(
            "INSERT OR REPLACE INTO pending_reset (email, username, code, expires, attempts) VALUES (?, ?, ?, ?, 0)",
            (email, username, code, time.time() + 600)
        )
        con.commit()
        con.close()
        try:
            _send_mail(
                email, 'Roa 비밀번호 재설정 코드',
                f'{username} 님의 비밀번호 재설정 코드: {code}\n\n10분 안에 입력해주세요.\n\n'
                '본인이 요청하지 않은 경우 이 메일을 무시하세요.'
            )
        except Exception as e:
            print(f"[forgot_password] mail failed for {email}: {e}", flush=True)
    else:
        con.close()

    # 일치 여부와 무관하게 항상 동일 응답 (열거 방지)
    return jsonify({"success": True, "message": _RESET_SENT_MSG})


@app.route('/api/reset-password', methods=['POST'])
def reset_password():
    data = request.get_json(silent=True) or {}
    username = str(data.get('username') or '').strip()
    email = str(data.get('email') or '').strip().lower()
    code = str(data.get('code') or '').strip()
    new_password = str(data.get('new_password') or '').strip()

    if not username or not email or not code or not new_password:
        return jsonify({"success": False, "error": "모든 필드를 입력해주세요."})

    if not PW_REGEX.match(new_password):
        return jsonify({"success": False, "error": "비밀번호는 영문, 숫자, 기호를 모두 포함한 8자 이상이어야 합니다."})

    con = sqlite3.connect(DB_FILE)
    con.row_factory = sqlite3.Row
    pending = con.execute(
        "SELECT * FROM pending_reset WHERE LOWER(email) = ?", (email,)
    ).fetchone()
    if not pending:
        con.close()
        return jsonify({"success": False, "error": "재설정 요청이 없습니다. 다시 시도해주세요."})
    if time.time() > pending['expires']:
        con.execute("DELETE FROM pending_reset WHERE LOWER(email) = ?", (email,))
        con.commit()
        con.close()
        return jsonify({"success": False, "error": "코드가 만료되었습니다. 다시 요청해주세요."})
    if not hmac.compare_digest(pending['code'], code):
        left = _register_code_failure(con, 'pending_reset', 'email', email, pending['attempts'])
        con.commit(); con.close()
        if left <= 0:
            return jsonify({"success": False, "error": "코드를 너무 많이 틀렸어요. 재설정을 다시 요청해주세요."})
        return jsonify({"success": False, "error": f"코드가 올바르지 않습니다. ({left}회 남음)"})

    # 대상 계정은 forgot 단계에서 매칭 검증 후 저장한 pending.username이다.
    # reset 요청의 username이 그것과 다르면 거부한다(코드는 이미 통과했으므로 노출 무관).
    if (pending['username'] or '') != username:
        con.close()
        return jsonify({"success": False, "error": "요청 정보가 일치하지 않습니다. 다시 시도해주세요."})

    # username + email 조합으로 정확히 그 계정만 변경 (다중 계정 모호성 제거)
    new_hash = hash_password(new_password)
    updated = con.execute(
        "UPDATE users SET password_hash = ? WHERE username = ? AND LOWER(email) = ?",
        (new_hash, username, email)
    )
    if updated.rowcount == 0:
        con.execute("DELETE FROM pending_reset WHERE LOWER(email) = ?", (email,))
        con.commit()
        con.close()
        return jsonify({"success": False, "error": "해당 계정을 찾을 수 없습니다."})
    con.execute("DELETE FROM pending_reset WHERE LOWER(email) = ?", (email,))
    con.commit()
    con.close()

    return jsonify({"success": True, "message": "비밀번호가 변경되었습니다. 로그인해주세요."})


@app.route('/api/login', methods=['POST'])
def login():
    ip = get_client_ip()

    data = request.get_json(silent=True) or {}
    username = data.get('username', '')
    password = data.get('password', '')
    if not isinstance(username, str) or not isinstance(password, str):
        return jsonify({"success": False, "error": "아이디와 비밀번호를 입력해주세요."}), 400

    # 잠금 확인
    if is_locked_out(ip):
        first = get_first_attempt_time(ip)
        remaining = int(LOCKOUT_TIME - (time.time() - first)) if first else LOCKOUT_TIME
        write_auth_log("LOGIN_FAIL", ip, username, "locked_out")
        return jsonify({"success": False, "error": f"로그인 시도 초과. {remaining}초 후 다시 시도하세요."}), 429

    # 기존 단일 계정 확인 (타이밍 공격 방지를 위해 상수 시간 비교)
    if ROA_PASSWORD and username == ROA_USERNAME and hmac.compare_digest(password.encode(), ROA_PASSWORD.encode()):
        clear_attempts(ip)
        write_auth_log("LOGIN_SUCCESS", ip, username)
        session['logged_in'] = True
        session['username'] = username
        session['login_time'] = datetime.now().isoformat()
        session.permanent = True
        return jsonify({"success": True})

    # 회원가입된 유저 확인
    user = get_user(username)
    if user and verify_password(password, user.get('password_hash')):
        clear_attempts(ip)
        write_auth_log("LOGIN_SUCCESS", ip, username)
        session['logged_in'] = True
        session['username'] = username
        session['login_time'] = datetime.now().isoformat()
        session.permanent = True
        return jsonify({"success": True})

    record_failed_attempt(ip)
    failed = get_attempt_count(ip)
    remaining = MAX_ATTEMPTS - failed
    write_auth_log("LOGIN_FAIL", ip, username, "no_such_user" if not user else "bad_password")
    if remaining <= 0:
        return jsonify({"success": False, "error": f"로그인 시도 초과. {LOCKOUT_TIME//60}분 후 다시 시도하세요."}), 429
    return jsonify({"success": False, "error": f"비밀번호가 틀렸어요. ({failed}/{MAX_ATTEMPTS}회 실패, {remaining}회 남음)"})

@app.route('/api/logout', methods=['POST'])
def logout():
    session.clear()
    resp = jsonify({"success": True})
    resp.delete_cookie('session', path='/', samesite='Lax')
    return resp

@app.route('/api/account/delete', methods=['POST'])
@login_required
def delete_account(username):
    write_access_log(username)

    # 기본 관리자 계정은 탈퇴 불가
    if username == ROA_USERNAME:
        return jsonify({"success": False, "error": "관리자 계정은 탈퇴할 수 없습니다."}), 403

    data = request.get_json(silent=True) or {}
    password = data.get('password', '')
    if not password or not isinstance(password, str):
        return jsonify({"success": False, "error": "비밀번호를 입력해주세요."}), 400

    user = get_user(username)
    if not user or not verify_password(password, user.get('password_hash')):
        return jsonify({"success": False, "error": "비밀번호가 틀렸습니다."}), 401

    user_email = (user.get('email') or '').strip().lower()

    # 1. 디스크 데이터 완전 삭제 (sessions/{username}/, planners/{username}.json, vector memory)
    purge_user_files(username)

    # 2. DB에서 유저 + 관련 데이터 모두 삭제
    con = sqlite3.connect(DB_FILE)
    sub_ids = [r[0] for r in con.execute(
        "SELECT id FROM subscriptions WHERE username = ?", (username,)
    ).fetchall()]
    if sub_ids:
        placeholders = ','.join('?' * len(sub_ids))
        con.execute(f"DELETE FROM billing_history WHERE subscription_id IN ({placeholders})", sub_ids)
    con.execute("DELETE FROM subscriptions WHERE username = ?", (username,))
    con.execute("DELETE FROM users WHERE username = ?", (username,))
    con.execute("DELETE FROM token_usage WHERE username = ?", (username,))
    con.execute("DELETE FROM image_usage WHERE username = ?", (username,))
    con.execute("DELETE FROM search_usage WHERE username = ?", (username,))
    con.execute("DELETE FROM user_settings WHERE username = ?", (username,))
    # 진행 중이던 가입/비번재설정 흔적도 함께 정리 (재가입 시 충돌 방지)
    con.execute("DELETE FROM pending_users WHERE username = ?", (username,))
    if user_email:
        con.execute("DELETE FROM pending_reset WHERE LOWER(email) = ?", (user_email,))
    con.commit()
    con.close()

    # 3. 세션 초기화 + 로그아웃
    session.clear()
    resp = jsonify({"success": True})
    resp.delete_cookie('session', path='/', samesite='Lax')
    return resp

@app.route('/api/sessions', methods=['GET'])
@login_required
def get_sessions(username):
    write_access_log(username)
    # Free 플랜: 30일 이상 된 세션 자동 삭제.
    # 반드시 effective plan으로 판단한다 — users.plan은 Pro 권한을 별도 기록한다.
    if username != ROA_USERNAME and get_effective_plan(username) == 'free':
        cleanup_free_sessions(username)
    return jsonify({"success": True, "sessions": list_sessions(username)})

@app.route('/api/sessions', methods=['POST'])
@login_required
def create_session(username):
    write_access_log(username)
    sid = datetime.now().strftime("%Y%m%d%H%M%S%f")
    data = {"id": sid, "title": "새 채팅", "messages": [], "created": datetime.now().strftime("%Y-%m-%d %H:%M")}
    body = request.get_json(silent=True) or {}
    title = str(body.get('title') or '').strip()[:80]
    pid = str(body.get('project_id') or '').strip()[:64]
    if title:
        data["title"] = title
    if pid:
        # 프로젝트 화면에서 시작한 채팅은 즉시 연결해야 한다. 파일이 없으면
        # /api/sessions/<sid>/project 가 404를 내므로 이 경우에만 바로 저장한다.
        # (메시지 없는 세션은 list_sessions가 숨기므로 빈 파일이 목록을 어지럽히지 않는다)
        data["projectId"] = pid
        save_session(sid, data, username)
    # 그 외에는 첫 메시지가 올 때 파일 생성 - 지금은 저장하지 않음
    return jsonify({"success": True, "session": data})

@app.route('/api/sessions/<sid>', methods=['GET'])
@login_required
def get_session(username, sid):
    data = load_session(sid, username)
    return jsonify({"success": True, "session": data})

@app.route('/api/sessions/<sid>/status', methods=['GET'])
@login_required
def session_status(username, sid):
    """세션의 응답 생성 진행 상태. 재진입/재접속한 클라이언트가 호출한다.
    ?after=<offset> 을 주면 그 지점 이후의 partial_text만 돌려준다.

    상태 판단의 진실 원천은 세션 파일의 pending 필드이고,
    메모리 캐시(_generation_status)는 실시간 텍스트를 얹어주는 보조 역할이다."""
    after = request.args.get('after', default=0, type=int) or 0
    _gc_generation_status()

    data = load_session(sid, username)   # stale pending 정리 포함
    pending = data.get("pending")
    st = get_generation(sid, username)

    resp = {
        "success": True,
        "messages": data.get("messages", []),
        "title": data.get("title", "새 채팅"),
    }

    # pending이 남아있는 동안에만 진행 중 텍스트를 내려준다.
    #
    # pending이 사라졌다는 것은 finalize_generation이 이미 끝나 세션 파일에
    # 최종 답변이 들어갔다는 뜻이다. 이때 메모리 버퍼(partial)를 함께 보내면
    # 클라이언트가 messages 안의 답변 위에 같은 텍스트를 한 번 더 붙여
    # 답변이 두 번 표시된다.
    #
    # (예전에는 이 구간에서도 generating을 유지했다. 생성 이미지가 메모리에만
    #  있어서 idle로 확정하면 이미지를 놓쳤기 때문인데, 지금은 이미지 경로가
    #  세션 메시지의 generatedImage로 저장되므로 그 방어가 필요 없다.)
    if pending:
        text = (st.get("partial") or "") if st else ""
        resp.update({
            "status": "generating",
            "kind": pending.get("kind", "chat"),
            "partial_text": text[after:] if after < len(text) else "",
            "offset": len(text),
        })
        return jsonify(resp)

    # pending이 없으면 세션 파일이 최종 상태다.
    resp["status"] = "idle"
    resp["offset"] = after
    if st and st.get("status") in ("done", "error"):
        resp["status"] = st["status"]
        if st.get("error"):
            resp["error"] = st["error"]
        if st.get("image_url"):
            resp["generated_image"] = st["image_url"]
    return jsonify(resp)

@app.route('/api/recordings', methods=['GET'])
@login_required
def api_recordings(username):
    """녹음 목록 (최신순). 본문은 빼고 카드에 필요한 정보만."""
    return jsonify({"success": True, "recordings": list_recordings(username)})

@app.route('/api/recordings/<rid>', methods=['GET'])
@login_required
def api_recording_detail(username, rid):
    data = load_recording(rid, username)
    if not data:
        return jsonify({"success": False, "error": "녹음을 찾을 수 없어요"}), 404
    return jsonify({"success": True, "recording": data})

@app.route('/api/recordings/<rid>', methods=['DELETE'])
@login_required
def api_recording_delete(username, rid):
    if not _RECORDING_ID_RE.match(str(rid or "")):
        return jsonify({"success": False, "error": "잘못된 id예요"}), 400
    f = recording_file(rid, username)
    if os.path.exists(f):
        os.remove(f)
    return jsonify({"success": True})

@app.route('/api/recordings/<rid>/chat', methods=['POST'])
@login_required
def api_recording_chat(username, rid):
    """이 녹음 내용을 채팅으로 이어가기.
    새 세션을 만들고 요약을 첫 assistant 메시지로 넣어, 사용자가 곧바로
    "액션 아이템만 다시 뽑아줘" 같은 후속 질문을 할 수 있게 한다."""
    data = load_recording(rid, username)
    if not data:
        return jsonify({"success": False, "error": "녹음을 찾을 수 없어요"}), 404

    sid = datetime.now().strftime("%Y%m%d%H%M%S%f")
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    title = (data.get("title") or "녹음")[:20]
    # 원문 전체를 넣으면 이후 모든 턴의 입력 토큰이 불어나므로 앞부분만 맥락으로 둔다.
    transcript = (data.get("transcript") or "").strip()
    excerpt = transcript[:4000] + ("\n…(이하 생략)" if len(transcript) > 4000 else "")
    session_data = {
        "id": sid,
        "title": f"🎙️ {title}",
        "created": now,
        "messages": [
            {"role": "user",
             "content": f"[녹음 기록: {data.get('title','')}]\n\n"
                        f"아래는 녹음 전사 내용이야. 이걸 바탕으로 이어서 물어볼게.\n\n{excerpt}",
             "time": now},
            {"role": "assistant", "content": data.get("summary", ""), "time": now},
        ],
    }
    save_session(sid, session_data, username)
    return jsonify({"success": True, "session_id": sid})

@app.route('/api/images/<filename>')
@login_required
def serve_generated_image(username, filename):
    """생성 이미지 서빙. 로그인 사용자 폴더에서만 찾으므로 남의 이미지는 볼 수 없다.
    파일명은 uuid4 hex + .png 형식만 허용한다(경로 이탈·추측 방지)."""
    if not _IMAGE_NAME_RE.match(filename or ""):
        return jsonify({"success": False, "error": "잘못된 파일명이에요"}), 400
    try:
        directory = os.path.abspath(user_images_dir(username))
    except ValueError:
        return jsonify({"success": False, "error": "잘못된 요청이에요"}), 400
    if not os.path.exists(os.path.join(directory, filename)):
        return jsonify({"success": False, "error": "이미지를 찾을 수 없어요"}), 404
    return send_from_directory(directory, filename, mimetype="image/png")

@app.route('/api/sessions/<sid>', methods=['DELETE'])
@login_required
def delete_session(username, sid):
    with get_session_lock(sid, username):
        # 세션이 참조하던 생성 이미지도 함께 정리 (고아 파일 방지)
        data = load_session(sid, username)
        delete_generated_images(username, data.get("messages"))
        f = session_file(sid, username)
        if os.path.exists(f): os.remove(f)
    return jsonify({"success": True})

@app.route('/api/sessions/<sid>/rename', methods=['POST'])
@login_required
def rename_session(username, sid):
    # 없는 세션을 열면 load_session이 빈 세션을 만들어 저장까지 해 버린다(유령 파일).
    if not os.path.exists(session_file(sid, username)):
        return jsonify({"success": False, "error": "세션을 찾을 수 없어요"}), 404
    body = request.get_json(silent=True) or {}
    title = str(body.get("title") or '').strip()[:80]
    if not title:
        return jsonify({"success": False, "error": "제목이 필요해요"}), 400
    with get_session_lock(sid, username):
        data = load_session(sid, username)
        data["title"] = title
        save_session(sid, data, username)
    return jsonify({"success": True})

@app.route('/api/sessions/<sid>/project', methods=['POST'])
@login_required
def set_session_project(username, sid):
    """세션을 프로젝트에 연결하거나(project_id) 연결을 해제한다(null).

    프로젝트 정의 자체는 아직 브라우저 localStorage에 있고 여기서는 id만
    보관한다. 그래서 값 검증은 길이 제한 정도만 하고, 존재하지 않는 프로젝트를
    가리키게 되면 화면에서 그냥 안 보일 뿐 다른 동작에는 영향이 없다.
    """
    if not os.path.exists(session_file(sid, username)):
        return jsonify({"success": False, "error": "세션을 찾을 수 없어요"}), 404
    pid = (request.json or {}).get('project_id')
    with get_session_lock(sid, username):
        data = load_session(sid, username)
        if pid:
            data["projectId"] = str(pid)[:64]
        else:
            data.pop("projectId", None)
        save_session(sid, data, username)
    return jsonify({"success": True, "projectId": data.get("projectId")})

@app.route('/api/chat', methods=['POST'])
@login_required
@usage_limited
def chat(username):
    write_access_log(username)

    # 플랜 확인 (부여된 Pro 권한을 반영한 effective plan)
    user_plan = get_effective_plan(username)

    data = request.get_json(silent=True) or {}
    message = data.get('message', '')
    if not isinstance(message, str):
        return jsonify({"success": False, "error": "message 형식이 올바르지 않습니다."}), 400
    if len(message) > 50_000:
        return jsonify({"success": False, "error": "메시지가 너무 길어요. 내용을 나눠서 보내주세요."}), 400
    sid = data.get('session_id')
    # session_id는 필수다. 없으면 사용자 구분이 없는 전역 memory.json 경로로
    # 처리돼 다른 사용자의 대화가 맥락에 섞인다. 프론트는 항상 세션을 만들어 보내므로
    # 정상 사용에는 영향이 없고, API 직접 호출로 이 경로에 진입하는 것을 막는다.
    if not sid:
        return jsonify({"success": False, "error": "세션 정보가 필요해요. 새 채팅을 시작해주세요."}), 400
    # body로 들어온 sid는 라우팅 검증을 안 거치므로 여기서 형식을 막는다.
    try:
        _safe_sid(sid)
    except ValueError:
        return jsonify({"success": False, "error": "잘못된 세션 id예요"}), 400
    image_data = data.get('image_data')
    image_media_type = data.get('image_media_type', 'image/jpeg')
    images = data.get('images')
    lang = data.get('lang', 'ko')
    is_regenerate = bool(data.get('is_regenerate'))
    if lang not in ('ko', 'en'):
        lang = 'ko'

    # 첨부 이름·종류는 클라이언트가 보내주는 값이므로 그대로 믿지 않고 정리한다.
    attachments = _clean_attachments(data.get('attachments'))

    # 구 형식(image_data 단일)도 그대로 받는다. 예전 클라이언트가 남아 있을 수 있다.
    if not images and image_data:
        images = [{"data": image_data, "media_type": image_media_type}]
    if images is not None:
        if not isinstance(images, list):
            return jsonify({"success": False, "error": "images 형식이 올바르지 않습니다."})
        images = [im for im in images if isinstance(im, dict) and im.get("data")]
        if len(images) > MAX_IMAGES_PER_MESSAGE:
            return jsonify({
                "success": False,
                "error": f"이미지는 한 번에 {MAX_IMAGES_PER_MESSAGE}장까지 함께 볼 수 있어요.",
            })

    # ── 이미지 첨부(vision): 짧은 동기 처리 유지 ─────────────
    if images:
        if not message:
            message = '이 이미지들에 대해 얘기해줘' if len(images) > 1 else '이 이미지에 대해 얘기해줘'
        try:
            answer, tokens = analyze_images(images, message, lang=lang)
            add_daily_tokens(username, tokens)
            add_to_session(sid, "user", message, username, attachments=attachments)
            add_to_session(sid, "assistant", answer, username, regenerable=False)
            return jsonify({"success": True, "answer": answer})
        except Exception as e:
            return _internal_error("chat-images", e)

    # ── 세션 경로: 백그라운드 생성 ───────────────────────────
    # 순서 고정: 활성 작업 확인 → (거부면 즉시 반환) → user 메시지 저장 →
    # pending 기록 → 스레드 스폰. 앞의 셋은 begin_generation이 한 락 안에서 처리.
    ok, convo = begin_generation(sid, username, message, is_regenerate)
    if not ok:
        return jsonify({
            "success": False,
            "error": "이미 응답을 생성하고 있어요. 잠시만 기다려 주세요.",
            "generating": True,
        }), 409

    spawn_generation(username, sid, message, convo, lang, is_regenerate, user_plan)
    key = _gen_key(sid, username)

    # ─── SSE 스트리밍 분기 (?stream=1) ────────────────────
    # 요청 핸들러는 더 이상 생성 주체가 아니라 누적 버퍼의 구독자다.
    # 연결이 끊겨 이 제너레이터가 죽어도 백그라운드 작업은 계속 진행된다.
    if request.args.get('stream') == '1':
        def sse():
            offset = 0
            deadline = time.time() + GENERATION_MAX_WAIT
            while True:
                st = _generation_status.get(key)
                if st is None:
                    yield f"data: {json.dumps({'type': 'error', 'error': '생성 상태를 찾지 못했어요.'}, ensure_ascii=False)}\n\n"
                    return

                text = st.get("partial") or ""
                if len(text) > offset:
                    chunk = text[offset:]
                    offset = len(text)
                    yield f"data: {json.dumps({'type': 'delta', 'text': chunk}, ensure_ascii=False)}\n\n"

                status = st.get("status")
                if status == "done":
                    payload = {'type': 'done', 'answer': st.get("answer") or text, 'offset': offset}
                    if st.get("image_url"):
                        payload['generated_image'] = st["image_url"]
                    yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
                    return
                if status == "error":
                    yield f"data: {json.dumps({'type': 'error', 'error': st.get('error') or 'unknown'}, ensure_ascii=False)}\n\n"
                    return
                if time.time() > deadline:
                    yield f"data: {json.dumps({'type': 'error', 'error': '응답 생성이 지연되고 있어요.'}, ensure_ascii=False)}\n\n"
                    return
                time.sleep(SSE_POLL_INTERVAL)

        return Response(
            stream_with_context(sse()),
            mimetype='text/event-stream',
            headers={
                'Cache-Control': 'no-cache',
                'X-Accel-Buffering': 'no',  # nginx 버퍼링 방지
                'Connection': 'keep-alive',
            },
        )
    # ─── /SSE ────────────────────────────────────────────

    # 논스트리밍(재생성 등): 완료까지 대기 후 JSON 반환.
    # 대기 중 연결이 끊겨도 백그라운드는 끝까지 진행되어 세션에 저장된다.
    deadline = time.time() + GENERATION_MAX_WAIT
    while True:
        st = _generation_status.get(key)
        if st is None:
            return jsonify({"success": False, "error": "생성 상태를 찾지 못했어요."})
        status = st.get("status")
        if status == "done":
            resp = {"success": True, "answer": st.get("answer") or ""}
            if st.get("image_url"):
                resp["generated_image"] = st["image_url"]
            return jsonify(resp)
        if status == "error":
            return jsonify({"success": False, "error": st.get("error") or "unknown"})
        if time.time() > deadline:
            return jsonify({
                "success": False,
                "error": "응답 생성이 지연되고 있어요. 잠시 후 다시 확인해 주세요.",
                "generating": True,
            }), 202
        time.sleep(0.1)

@app.route('/api/weather', methods=['GET'])
def weather():
    if not check_login(): return jsonify({"success": False}), 401
    data = get_weather()
    return jsonify({"success": True, "data": data}) if data else jsonify({"success": False})

# (제거됨) /api/save_memory, /api/clear, /api/vector-memory/{count,clear}:
# 프론트에서 호출하지 않는 죽은 라우트였다. 앞의 둘은 username 스코프가 없는
# 레거시 전역 memory.json을, 뒤의 둘은 유저별이 아닌 전역 벡터 컬렉션을
# 다뤄서 남겨둘 이유가 없다. 유저별 기억 관리는 /api/memory/* 가 담당한다.
# (load_memory/save_memory 함수 자체는 /api/chat의 sid 없는 예비 경로가
#  아직 참조하므로 남겨둔다.)

# ============================================
# 장기기억 (유저별 ChromaDB)
# ============================================
@app.route('/api/memory/clear', methods=['POST'])
@login_required
def memory_clear(username):
    try:
        vector_memory.clear_user(username)
        return jsonify({"success": True})
    except Exception as e:
        return _internal_error("memory-clear", e)

@app.route('/api/memory/list', methods=['GET'])
@login_required
def memory_list(username):
    try:
        memories = vector_memory.list_user(username, limit=50)
        count = vector_memory.count_user(username)
        return jsonify({"success": True, "memories": memories, "count": count})
    except Exception as e:
        return _internal_error("memory-list", e)

def extract_document_text(filepath, ext):
    """문서 파일에서 텍스트 추출 (.docx/.xlsx/.pptx/.txt/.csv)"""
    if ext == '.docx':
        from docx import Document
        doc = Document(filepath)
        lines = []
        # 단락 텍스트
        for p in doc.paragraphs:
            if p.text.strip():
                lines.append(p.text)
        # 표(table) 텍스트
        for table in doc.tables:
            for row in table.rows:
                cells = [cell.text.strip() for cell in row.cells]
                row_text = '\t'.join(c for c in cells if c)
                if row_text:
                    lines.append(row_text)
        return '\n'.join(lines)
    elif ext == '.xlsx':
        import openpyxl
        wb = openpyxl.load_workbook(filepath, data_only=True, read_only=True)
        lines = []
        for sheet in wb.worksheets:
            lines.append(f'[시트: {sheet.title}]')
            row_count = 0
            for row in sheet.iter_rows(values_only=True):
                if row_count >= 500:  # 메모리 보호: 시트당 최대 500행
                    lines.append('...(이하 생략)')
                    break
                cells = [str(c) if c is not None else '' for c in row]
                if any(c.strip() for c in cells):
                    lines.append('\t'.join(cells))
                    row_count += 1
        wb.close()
        return '\n'.join(lines)
    elif ext == '.pptx':
        from pptx import Presentation
        prs = Presentation(filepath)
        lines = []
        for i, slide in enumerate(prs.slides, 1):
            lines.append(f'[슬라이드 {i}]')
            for shape in slide.shapes:
                if shape.has_text_frame:
                    for para in shape.text_frame.paragraphs:
                        text = para.text.strip()
                        if text:
                            lines.append(text)
        return '\n'.join(lines)
    else:  # .txt, .csv
        # 한국어 파일 인코딩 자동 감지 (EUC-KR/CP949 포함)
        for enc in ('utf-8-sig', 'utf-8', 'cp949', 'euc-kr'):
            try:
                with open(filepath, encoding=enc) as f:
                    return f.read()
            except (UnicodeDecodeError, LookupError):
                continue
        with open(filepath, encoding='utf-8', errors='replace') as f:
            return f.read()

@app.route('/api/document', methods=['POST'])
@login_required
@usage_limited
def document_analyze(username):
    if 'file' not in request.files:
        return jsonify({"success": False, "error": "파일이 없어요"})
    file = request.files['file']
    question = request.form.get('question', '이 문서를 요약해줘')
    sid = request.form.get('session_id', '')
    err = _bad_sid(sid)
    if err:
        return err

    ext = os.path.splitext(file.filename or '')[1].lower()
    allowed_ext = {'.docx', '.xlsx', '.pptx', '.txt', '.csv'}
    if ext not in allowed_ext:
        return jsonify({"success": False, "error": f"지원하지 않는 파일 형식이에요 ({ext or '확장자 없음'})"})

    size_err = check_upload_size(file)
    if size_err:
        return jsonify(size_err)

    tmp_path = None
    text = ''
    try:
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
            file.save(tmp.name)
            tmp_path = tmp.name
        text = extract_document_text(tmp_path, ext)
    except Exception as e:
        return jsonify({"success": False, "error": f"파일 읽기 실패: {str(e)}"})
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

    if not text.strip():
        return jsonify({"success": False, "error": "문서에서 텍스트를 추출하지 못했어요"})

    # 토큰 초과 방지: 최대 8000자
    if len(text) > 8000:
        text = text[:8000] + '\n\n[이하 생략]'

    prompt = f"다음은 업로드된 문서 내용이야:\n\n{text}\n\n{question}"
    try:
        answer, tokens, _ = roa_gpt(prompt, [])
        add_daily_tokens(username, tokens)
        if sid:
            add_to_session(sid, "user", question, username,
                           attachments=[{"name": file.filename, "type": "document"}])
            add_to_session(sid, "assistant", answer, username, regenerable=False)
        return jsonify({"success": True, "response": answer})
    except Exception as e:
        return _internal_error("document", e)

@app.route('/api/pdf', methods=['POST'])
@login_required
@usage_limited
def pdf_upload(username):
    if 'file' not in request.files:
        return jsonify({"success": False, "error": "파일이 없어요"})
    file = request.files['file']
    question = request.form.get('question', '이 문서를 요약해줘')
    sid = request.form.get('session_id', '')
    err = _bad_sid(sid)
    if err:
        return err

    size_err = check_upload_size(file)
    if size_err:
        return jsonify(size_err)

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as tmp:
            file.save(tmp.name)
            tmp_path = tmp.name
        answer, tokens = analyze_pdf(tmp_path, question)
        add_daily_tokens(username, tokens)
    except Exception as e:
        print(f"[pdf] {type(e).__name__}: {e}", flush=True)
        error_msg = "PDF 분석에 실패했어요. 파일을 확인하고 다시 시도해주세요."
        if sid:
            add_to_session(sid, "user", question, username,
                           attachments=[{"name": file.filename, "type": "pdf"}])
            add_to_session(sid, "assistant", error_msg, username, regenerable=False)
        return jsonify({"success": False, "error": error_msg})
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)
    if sid:
        add_to_session(sid, "user", question, username,
                       attachments=[{"name": file.filename, "type": "pdf"}])
        add_to_session(sid, "assistant", answer, username, regenerable=False)
    return jsonify({"success": True, "response": answer})

@app.route('/api/youtube', methods=['POST'])
@login_required
@usage_limited
def youtube_analyze(username):
    data = request.get_json(silent=True) or {}
    url = data.get('url', '')
    question = data.get('question', '이 영상을 요약해줘')
    sid = data.get('session_id', '')
    err = _bad_sid(sid)
    if err:
        return err
    lang = data.get('lang', 'ko')
    if lang not in ('ko', 'en'):
        lang = 'ko'
    is_regenerate = bool(data.get('is_regenerate'))
    answer, tokens = analyze_youtube(url, question, lang=lang)
    add_daily_tokens(username, tokens)
    if sid:
        if is_regenerate:
            # 재생성은 질문을 다시 쌓지 않고 답변만 갈아끼운다.
            replace_last_answer(sid, username, answer)
        else:
            add_to_session(sid, "user", f"유튜브 분석: {url}\n질문: {question}", username)
            add_to_session(sid, "assistant", answer, username, regenerable=True)
    return jsonify({"success": True, "answer": answer})

@app.route('/api/weather/location', methods=['POST'])
def weather_by_location():
    if not check_login(): return jsonify({"success": False}), 401
    data = request.get_json(silent=True) or {}
    try:
        # 문자열이 그대로 URL에 들어가면 쿼리 파라미터 주입이 가능하므로 숫자로 강제
        lat = float(data.get('lat'))
        lon = float(data.get('lon'))
    except (TypeError, ValueError):
        return jsonify({"success": False, "error": "위도/경도 필요"}), 400
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return jsonify({"success": False, "error": "위도/경도 범위가 올바르지 않아요"}), 400
    api_key = os.getenv("OPENWEATHER_API_KEY")
    if not api_key:
        return jsonify({"success": False, "error": "날씨 서비스가 설정되지 않았어요."}), 503
    try:
        url = f"http://api.openweathermap.org/data/2.5/weather?lat={lat}&lon={lon}&appid={api_key}&units=metric&lang=kr"
        res = requests.get(url, timeout=6).json()
        return jsonify({"success": True, "data": {
            "city": res.get('name', f"{lat:.2f},{lon:.2f}"),
            "temp": res['main']['temp'],
            "feels": res['main']['feels_like'],
            "desc": res['weather'][0]['description'],
            "humidity": res['main']['humidity']
        }})
    except Exception as e:
        return _internal_error("weather-location", e, "날씨 정보를 가져오지 못했어요.")

# (제거됨) /api/weather/city (change_city):
# 프론트에서 호출하지 않는 죽은 라우트였다. 로그인한 사용자 누구나 서버의
# .env 파일을 직접 덮어써 전역 WEATHER_CITY(모든 사용자 공유)를 바꿀 수 있었고,
# 파일 동시 쓰기로 .env가 손상될 위험도 있었다. 위치 기반 날씨는
# /api/weather/location 이 담당하므로 기능 손실도 없다.

# ============================================
# 이미지 분석 (GPT 비전)
# ============================================
def _clean_attachments(raw, limit=MAX_IMAGES_PER_MESSAGE):
    """클라이언트가 보낸 첨부 메타데이터를 세션에 넣기 전에 정리한다.
    이름 길이·개수·종류를 제한해 세션 파일이 임의의 값으로 부풀지 않게 한다."""
    if not isinstance(raw, list):
        return None
    out = []
    for a in raw[:limit]:
        if not isinstance(a, dict):
            continue
        name = str(a.get('name') or '').strip()[:120]
        if not name:
            continue
        typ = a.get('type')
        out.append({"name": name, "type": typ if typ in _ATTACH_TYPES else 'image'})
    return out or None


def analyze_images(images, question, lang='ko'):
    """이미지 여러 장을 한 번의 GPT 호출로 함께 본다.

    images: [{"data": base64, "media_type": "image/png"}, ...]

    장별로 따로 호출하면 모델이 서로를 보지 못해 "이 두 사진 비교해줘" 같은
    교차 추론이 불가능하다. 한 메시지에 이미지 파트를 나란히 넣어야 한다.
    """
    parts = [
        gpt_image_part(img["data"], img.get("media_type") or "image/jpeg")
        for img in images
    ]
    parts.append({"type": "text", "text": question})
    return gpt_complete(parts, system=build_roa_system(lang), max_tokens=1024)


def analyze_image(image_data, media_type, question, lang='ko'):
    """단일 이미지용 하위 호환 래퍼."""
    return analyze_images([{"data": image_data, "media_type": media_type}], question, lang=lang)

@app.route('/api/image', methods=['POST'])
@login_required
@usage_limited
def image_analyze(username):
    if 'file' not in request.files:
        return jsonify({"success": False, "error": "이미지 파일이 없어요"})

    file = request.files['file']
    question = request.form.get('question', '이 이미지를 설명해줘')
    sid = request.form.get('session_id', '')
    err = _bad_sid(sid)
    if err:
        return err

    size_err = check_upload_size(file)
    if size_err:
        return jsonify(size_err)

    allowed = {'image/jpeg', 'image/png', 'image/gif', 'image/webp'}
    media_type = file.content_type or 'image/jpeg'
    if media_type not in allowed:
        ext = os.path.splitext(file.filename or '')[1].lower()
        ext_map = {'.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp'}
        media_type = ext_map.get(ext, 'image/jpeg')

    import base64
    image_data = base64.b64encode(file.read()).decode('utf-8')

    try:
        answer, tokens = analyze_image(image_data, media_type, question)
        add_daily_tokens(username, tokens)

        if sid:
            add_to_session(sid, "user", question, username,
                           attachments=[{"name": file.filename, "type": "image"}])
            add_to_session(sid, "assistant", answer, username, regenerable=False)

        return jsonify({"success": True, "response": answer})
    except Exception as e:
        return _internal_error("image", e)

@app.route('/api/video', methods=['POST'])
@login_required
@usage_limited
def video_analyze(username):
    if 'file' not in request.files:
        return jsonify({"success": False, "error": "파일이 없어요"})
    file = request.files['file']
    question = request.form.get('question', '이 영상의 내용을 요약해줘')
    sid = request.form.get('session_id', '')
    err = _bad_sid(sid)
    if err:
        return err

    size_err = check_media_size(file, get_user_plan(username))
    if size_err:
        return jsonify(size_err)

    suffix = os.path.splitext(file.filename or '')[1] or '.tmp'
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        file.save(tmp.name)
        try:
            response, tokens = analyze_video(tmp.name, question)
            add_daily_tokens(username, tokens)
            if sid:
                add_to_session(sid, "user", question, username,
                               attachments=[{"name": file.filename, "type": "video"}])
                add_to_session(sid, "assistant", response, username, regenerable=False)
            return jsonify({"success": True, "response": response})
        except Exception as e:
            print(f"[video] {type(e).__name__}: {e}", flush=True)
            error_msg = "영상 분석에 실패했어요. 파일을 확인하고 다시 시도해주세요."
            if sid:
                add_to_session(sid, "user", question, username,
                               attachments=[{"name": file.filename, "type": "video"}])
                add_to_session(sid, "assistant", error_msg, username, regenerable=False)
            return jsonify({"success": False, "error": error_msg})
        finally:
            try:
                os.unlink(tmp.name)
            except OSError:
                pass


# (제거됨) migrate_memory: 라우트 데코레이터가 없어 도달 불가능한 죽은 함수였다.
# 게다가 사용자 스코프 없는 전역 memory.json을 "로그인한 아무 사용자"의 세션으로
# 복사하는 코드라, 라우트가 복원되면 그대로 프라이버시 사고가 된다.
# 사이드바의 "이전 대화 불러오기" 버튼(항상 404)도 함께 제거했다.

@app.route('/api/voice', methods=['POST'])
@login_required
@usage_limited
def voice_input(username):
    if 'file' not in request.files:
        return jsonify({"success": False, "error": "파일이 없어요"})
    file = request.files['file']

    size_err = check_media_size(file, get_user_plan(username))
    if size_err:
        return jsonify(size_err)

    with tempfile.NamedTemporaryFile(delete=False, suffix='.webm') as tmp:
        file.save(tmp.name)
        try:
            # Whisper는 분당 과금이라 시간을 토큰으로 환산해 한도에 합산한다
            duration = probe_media_seconds(tmp.name)
            with open(tmp.name, "rb") as f:
                transcript = openai_client().audio.transcriptions.create(
                    model="whisper-1", file=f
                )
            if transcript.text.strip():
                add_daily_tokens(username, whisper_tokens(duration))
            return jsonify({"success": True, "text": transcript.text})
        except Exception as e:
            return _internal_error("voice", e, "음성 인식에 실패했어요. 다시 시도해주세요.")
        finally:
            os.unlink(tmp.name)

def transcribe_chunked(audio_path):
    """25MB 초과 오디오를 10분 단위 청크로 분할해 Whisper 순서대로 전송 후 텍스트 합치기 (Pro 전용).
    반환: (합친 텍스트, 실패한 청크 수). 실패를 조용히 삼키면 중간이 빠진 전사가
    '전체'처럼 요약되므로, 실패 수를 돌려줘 호출부가 사용자에게 알릴 수 있게 한다."""
    import subprocess, math
    # 오디오 길이 확인
    probe = subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", audio_path],
        capture_output=True, text=True, timeout=30
    )
    duration = 600.0  # fallback: 10분
    try:
        info = json.loads(probe.stdout)
        duration = float(info['format']['duration'])
    except Exception:
        pass

    chunk_secs = 600  # 10분 단위
    num_chunks = max(1, math.ceil(duration / chunk_secs))
    texts = []
    failed = 0
    for i in range(num_chunks):
        start = i * chunk_secs
        with tempfile.NamedTemporaryFile(delete=False, suffix='.mp3') as chunk_tmp:
            chunk_path = chunk_tmp.name
        try:
            proc = subprocess.run(
                ["ffmpeg", "-i", audio_path, "-ss", str(start), "-t", str(chunk_secs),
                 "-ar", "16000", "-ac", "1", "-b:a", "64k", chunk_path, "-y"],
                capture_output=True, text=True, timeout=300
            )
            if proc.returncode != 0 or not os.path.exists(chunk_path) or os.path.getsize(chunk_path) == 0:
                failed += 1
                print(f"[transcribe_chunked] ffmpeg failed chunk {i+1}/{num_chunks} (rc={proc.returncode})", flush=True)
                continue
            with open(chunk_path, "rb") as f:
                chunk_transcript = openai_client().audio.transcriptions.create(
                    model="whisper-1", file=f
                )
            if chunk_transcript.text.strip():
                texts.append(chunk_transcript.text)
        except Exception as e:
            failed += 1
            print(f"[transcribe_chunked] chunk {i+1}/{num_chunks} failed: {type(e).__name__}: {e}", flush=True)
        finally:
            try:
                os.unlink(chunk_path)
            except OSError:
                pass
    return " ".join(texts), failed


@app.route('/api/meeting', methods=['POST'])
@login_required
@usage_limited
def meeting_analyze(username):
    if 'file' not in request.files:
        return jsonify({"success": False, "error": "파일이 없어요"})
    file = request.files['file']
    question = request.form.get('question', '이 음성 내용을 요약하고 중요한 내용을 정리해줘')

    # 플랜 확인 (부여된 Pro 권한을 반영한 effective plan)
    user_plan = get_effective_plan(username)

    suffix = os.path.splitext(file.filename)[1] if file.filename else '.webm'
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        file.save(tmp.name)
        file_size = os.path.getsize(tmp.name)

        # 플랜별 상한 초과 차단 (Free 25MB / Pro·admin 200MB)
        if (file_size > MAX_FREE_AUDIO_SIZE and user_plan == 'free') or \
           (file_size > MAX_PRO_AUDIO_SIZE and user_plan in ('pro', 'admin')):
            try:
                os.unlink(tmp.name)
            except OSError:
                pass
            if user_plan == 'free':
                err = "녹음 파일이 너무 커요. 25MB 이하만 가능해요. Pro 플랜은 긴 녹음을 지원해요."
            else:
                err = "녹음 파일이 너무 커요. 200MB 이하만 업로드 가능해요."
            return jsonify({"success": False, "error": err})

        # Whisper는 분당 과금이라 시간을 토큰으로 환산해 한도에 합산한다
        duration = probe_media_seconds(tmp.name)

        try:
            import subprocess
            # ffmpeg으로 오디오 추출
            with tempfile.NamedTemporaryFile(delete=False, suffix='.mp3') as audio_tmp:
                audio_path = audio_tmp.name
            subprocess.run(
                ["ffmpeg", "-i", tmp.name, "-vn", "-ar", "16000", "-ac", "1", "-b:a", "64k", audio_path, "-y"],
                capture_output=True, text=True, timeout=600
            )

            # Pro/admin: 대용량 파일 청크 분할 처리
            failed_chunks = 0
            if file_size > MAX_FREE_AUDIO_SIZE and user_plan in ('pro', 'admin'):
                text, failed_chunks = transcribe_chunked(audio_path)
                try:
                    os.unlink(audio_path)
                except OSError:
                    pass
            else:
                with open(audio_path, "rb") as f:
                    transcript = openai_client().audio.transcriptions.create(
                        model="whisper-1", file=f
                    )
                try:
                    os.unlink(audio_path)
                except OSError:
                    pass
                text = transcript.text

            if not text.strip():
                return jsonify({"success": False, "error": "음성을 인식할 수 없어요."})

            # 일부 청크 전사가 실패하면 중간이 빠진 채로 요약된다. 모델과 사용자
            # 모두에게 이 사실을 알려 "완전한 전사"로 오인하지 않게 한다.
            partial_notice = ""
            if failed_chunks:
                partial_notice = (
                    f"\n\n⚠️ 참고: 녹음 일부 구간({failed_chunks}개 10분 블록)의 전사에 "
                    "실패해 해당 구간 내용은 빠져 있어요. 아래 요약은 전사된 부분만 반영해요.")

            # 전사가 실제로 이뤄진 뒤에만 집계한다
            add_daily_tokens(username, whisper_tokens(duration))

            prompt = f"""다음 음성 내용을 분석해줘. 회의일 수도 있고, 메모나 강의, 대화일 수도 있어.

[인식된 내용]
{text[:10000]}

[요청]
{question}

아래 형식으로 자연스럽게 정리해줘:

📝 내용 요약
(핵심 내용 3~5줄)

✅ 주요 항목
1. ...
2. ...

💡 중요 포인트
- ...
"""
            answer, tokens = gpt_complete(prompt)
            add_daily_tokens(username, tokens)

            # 요약과 원문을 합치지 않고 따로 저장한다. 상세 화면에서 나눠 보여주고,
            # 오디오는 남기지 않으므로 이 텍스트가 유일한 결과물이다.
            rid = datetime.now().strftime("%Y%m%d%H%M%S%f")
            created = datetime.now().strftime("%Y-%m-%d %H:%M")
            record = {
                "id": rid,
                # 제목은 녹음 시각으로 고정한다. 요약 첫 줄을 쓰면 프롬프트가
                # 내보내는 머리말에 휘둘려 제목이 들쭉날쭉해진다.
                # "무슨 내용"은 목록 카드의 preview(요약 미리보기)가 보여준다.
                "title": created,
                "summary": answer.strip() + partial_notice,
                "transcript": text.strip(),
                "duration": int(duration or 0),
                "question": question,
                "created": created,
            }
            save_recording(record, username)

            return jsonify({"success": True, "recording": record})
        except Exception as e:
            return _internal_error("meeting", e, "녹음 분석에 실패했어요. 다시 시도해주세요.")
        finally:
            try:
                os.unlink(tmp.name)
            except OSError:
                pass

# ============================================
# TTS (Text-to-Speech) - OpenAI TTS API
# ============================================
@app.route('/api/tts', methods=['POST'])
@login_required
@usage_limited
def tts(username):
    data = request.get_json(silent=True) or {}
    text = data.get('text')
    text = text.strip() if isinstance(text, str) else ''
    if not text:
        return jsonify({"success": False, "error": "텍스트 없음"}), 400

    # 마크다운/특수기호 제거 후 TTS 전송
    import re as _re
    clean = _re.sub(r'\*\*?(.*?)\*\*?', r'\1', text)
    clean = _re.sub(r'#{1,6}\s?', '', clean)
    clean = _re.sub(r'---+', '', clean)
    clean = _re.sub(r'<[^>]+>', '', clean)
    clean = clean.strip()

    # 모델 입력 상한(2,000 토큰)을 넘지 않도록 자른다
    truncated = len(clean) > TTS_MAX_CHARS
    if truncated:
        clean = clean[:TTS_MAX_CHARS]

    try:
        response = openai_client().audio.speech.create(
            model="gpt-4o-mini-tts",
            voice="coral",
            input=clean,
        )
        # TTS도 과금되므로 문자 수를 토큰으로 환산해 같은 일일 한도에 합산한다
        add_daily_tokens(username, len(clean) * TTS_TOKENS_PER_CHAR)
        audio_b64 = base64.b64encode(response.content).decode('utf-8')
        return jsonify({"success": True, "audio": audio_b64, "truncated": truncated})
    except Exception as e:
        return _internal_error("tts", e, "음성 변환에 실패했어요. 다시 시도해주세요.")


if __name__ == '__main__':
    migrate_root_sessions()  # 루트 세션 파일 → sessions/{ROA_USERNAME}/ 로 이동 (최초 1회)
    username_src = "환경변수" if "ROA_USERNAME" in os.environ else "기본값(roa)"
    password_src = "환경변수" if "ROA_PASSWORD" in os.environ else "미설정"
    print("=" * 40)
    print("  Roa 웹 서버 시작! 🔒 보안 모드")
    print(f"  아이디: {ROA_USERNAME} [{username_src}]")
    print(f"  비밀번호: {'*' * len(ROA_PASSWORD)} [{password_src}] (길이: {len(ROA_PASSWORD)})")
    print("=" * 40)
    port = int(os.environ.get("PORT", 5000))
    app.run(debug=False, host='0.0.0.0', port=port)
