# 음료 주문 MVP

Supabase에 주문을 저장하고 실시간으로 주문 상태를 동기화하는 최소 버전입니다.

## 실행

1. Supabase SQL Editor에서 `supabase/schema.sql`을 실행합니다.
2. SQL Editor에서 `select private.set_admin_pin('원하는 숫자 비밀번호');`를 한 번 실행합니다.
3. `npm install` 후 `npm run dev`를 실행합니다.
4. 주문 화면은 `/#order`, 관리 화면은 `/#admin`입니다.

관리 화면에서 주문용 QR을 확인하고 저장할 수 있으며, 메뉴 추가·이름 수정·삭제·품절 전환이 가능합니다. 메뉴는 ADE / NON SODA로 나뉘어 보여줍니다. 태블릿에서는 화면을 연 뒤 **알림 켜기**를 한 번 눌러주세요.
주문자는 이름과 인원수를 먼저 입력한 뒤 음료를 주문합니다. 한 기기에서는 한국 시간 기준 하루 한 번만 주문할 수 있고, 주문이 취소된 경우에는 다시 주문할 수 있습니다.

## GitHub Pages와 화면 꺼짐 알림

운영 주소는 `https://moa6938.github.io/hanjan-order/`이며 `main` 브랜치의 `docs/`를 배포합니다. 수정 후 `npm run build` 결과를 `docs/`에 반영합니다. 서비스 워커·매니페스트·아이콘은 `/hanjan-order/` 범위를 사용합니다.

태블릿 Chrome에서 `#admin` 로그인 → 앱 설치 → 화면 꺼짐 알림 켜기 → 브라우저 알림 허용 → 알림 테스트 순서로 설정합니다. Supabase 대시보드 로그인은 일상 사용에 필요하지 않습니다. 기존 앱에서는 새로고침하고 기기별 알림을 한 번 허용하세요. 실제 잠금 화면 수신은 실기기로 확인해야 합니다. 소리·방해금지·배터리 제한과 Chrome 강제 종료는 수신에 영향을 줄 수 있습니다.

서버는 기존 Supabase의 `hanjan-push` Edge Function과 `hanjan_push_register/status/unregister` RPC를 사용합니다. 새 주문 INSERT는 비공개 큐와 pg_net으로 전송되며 cron이 실패를 재시도합니다. 프런트엔드는 공개키만 사용하며 VAPID 개인 키와 웹훅 비밀값은 서버에 유지합니다. 관리자 PIN은 메모리에만 보관합니다. `supabase/schema.sql` 재실행은 이번 클라이언트 배포에 필요하지 않습니다.

검증: `npm test`, `node test/pwa.test.mjs`, `npm run build`.

## MVP 제한

- 관리자 비밀번호는 4~12자리 숫자를 사용합니다. 실제 운영에서는 긴 비밀번호와 별도 인증 도입을 권장합니다.
- 주문 내용에는 개인정보를 입력하지 않는 운영을 권장합니다.
