#!/usr/bin/env python3
"""관리자용 수동 Pro 이용 기간 부여 CLI.

특정 계정에 Pro 이용 기간을 부여한다.
기본 관리자 계정(ROA_USERNAME)에는 부여할 수 없다.

사용법:
    python grant_pro.py <username>            # 만료 없는 Pro (권장: 테스트 계정)
    python grant_pro.py <username> --days 30  # 30일 뒤 만료
    python grant_pro.py <username> --plan magen

이 스크립트는 서버 프로세스와 무관하게 DB에 직접 부여한다(서버가 떠 있지 않아도 됨).
"""
import sys
import argparse

import roa_server as s  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description="관리자용 수동 Pro 이용 기간 부여")
    parser.add_argument("username", help="Pro를 부여할 계정 아이디")
    parser.add_argument("--days", type=int, default=None,
                        help="유효 일수. 생략하면 만료 없음(9999-12-31).")
    parser.add_argument("--plan", default="ai",
                        help="부여 플랜 (기본 ai). 가능: ai, magen, bundle")
    args = parser.parse_args()

    try:
        result = s.grant_manual_pro(args.username, days=args.days, plan=args.plan)
    except ValueError as e:
        print(f"✗ 부여 실패: {e}", file=sys.stderr)
        sys.exit(1)

    eff = s.get_effective_plan(args.username)
    forever = result['next_billing_date'] == s.MANUAL_GRANT_FOREVER
    print("✓ 수동 Pro 이용 기간 부여 완료")
    print(f"  - 계정          : {result['username']}")
    print(f"  - 플랜          : {result['plan']}")
    # 만료 있는 부여는 canceled 유예 방식으로 자동 만료된다(active로 두면 만료 안 됨).
    print(f"  - 상태          : {result['status']}"
          + ("  (만료 없음 · 영구)" if forever else "  (만료일까지 Pro 유지 후 자동 free)"))
    print(f"  - 만료일        : "
          + ("없음" if forever else f"{result['next_billing_date']} 이후 자동 free"))
    print(f"  - 적용 플랜 확인: get_effective_plan() = {eff}")
    if eff != "pro":
        print(f"  ⚠ 경고: effective plan이 'pro'가 아닙니다({eff}). 확인이 필요합니다.",
              file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
