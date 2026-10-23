# khu-global-smash

시험기간에 만든 경희대 국제캠퍼스 부수기.
학교 건물에 미사일을 쏘면 무너진다. PC 브라우저에서 돌아간다.

![](docs/screenshot.jpg)

지도는 OpenStreetMap, 지형은 SRTM 표고 데이터로 만들었고 건물 색은 사진을 보면서 하나씩 맞췄다.
3D 모델 파일은 없고 전부 코드로 블록을 쌓아서 만든다. 물리는 Rapier.

## 실행

```bash
npm install
npm run dev
```

http://localhost:5173 으로 접속. Node 20.19 이상이 필요하다.

## 조작

- 클릭: 미사일 발사
- 왼쪽 드래그 이동, 오른쪽 드래그 회전, 휠 확대·축소
- 숫자키: 무기 선택 (아직 미사일 하나)
- R: 리셋

오른쪽 위 패널에서 폭발 반경, 미사일 속도, 음량을 바꿀 수 있다.
잔해 소멸은 떨어진 잔해가 폭발에 몇 번 더 맞으면 없어질지 정하는 값이다(기본 4번). 0이면 잔해가 안 남고, 불가로 두면 계속 쌓인다.

## 지도 고치기

`overrides.json`에서 층수(`floors`), 빠진 건물 추가(`add`), 건물 빼기(`remove`)를 할 수 있다.
추가할 건물 좌표는 구글 지도에서 우클릭해서 복사한 [위도, 경도]를 그대로 넣으면 된다.

```json
"add": [{ "name": "새 건물", "floors": 3, "outline": [[37.2401, 127.0801], [37.2403, 127.0805], [37.2399, 127.0807]] }]
```

이름 없는 건물은 `campus.json`에서 `"name"`을 직접 채우면 된다.
지도를 새로 받으려면 `npm run fetch-osm` (1~2분 걸림). 다시 받아도 `overrides.json`이랑 직접 붙인 이름은 그대로 남는다.

## 아쉬운 점

- 맞은 부분만 부서져서 아래층이 날아가도 위층이 공중에 떠 있다
- 미사일이 중간에 있는 건물을 그냥 뚫고 지나간다
- 땅이 파인 건 보이기만 하고, 잔해는 원래 땅 높이에 놓인다

## 출처

- 지도 © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, ODbL. `campus.json`은 ODbL을 따른다
- 표고 NASA SRTM, [OpenTopoData](https://www.opentopodata.org/) API로 받음
- 코드는 [MIT](LICENSE)
