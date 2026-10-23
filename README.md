# khu-global-smash
시험기간

## 실행

Node.js 20.19 이상(또는 22.12 이상)이 필요합니다.

```bash
npm install
npm run dev
```

브라우저에서 터미널에 나온 주소(기본 http://localhost:5173)를 엽니다. 배포용 빌드는 `npm run build`이며 결과는 `dist/`에 생깁니다.

## 지도 수정

지도 데이터는 `campus.json`에 들어 있습니다(커밋됨). 원본을 다시 받으려면 아래 명령을 실행합니다. 1~2분이 걸리고 네트워크가 필요합니다.

```bash
npm run fetch-osm
```

다시 받아도 `overrides.json`은 바뀌지 않고, `campus.json`에 직접 적어 둔 건물 이름도 유지됩니다(OSM에 이름이 없는 건물만).

`overrides.json`에서 바꿀 수 있는 것:

- `floors`: 건물 이름 또는 OSM id(`w…`/`r…`) → 층수. id가 이름보다 우선합니다. 적지 않은 건물은 OSM의 `building:levels`를 쓰고, 그것도 없으면 2층입니다.
- `add`: 지도에 빠진 건물을 추가합니다. `outline`은 `[위도, 경도]` 꼭짓점 목록입니다(구글 지도에서 우클릭해 복사한 좌표 그대로).
  ```json
  "add": [{ "name": "새 건물", "floors": 3, "outline": [[37.2401, 127.0801], [37.2403, 127.0805], [37.2399, 127.0807]] }]
  ```
- `remove`: 빼고 싶은 건물 이름 또는 OSM id.

이름이 없는 건물에 이름을 붙이려면 `campus.json`에서 그 건물의 `"name"`을 채웁니다.

## 데이터 출처

- 지도: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, [ODbL 1.0](https://opendatacommons.org/licenses/odbl/) (캠퍼스 경계 relation 11246784 안쪽)
- 표고: NASA SRTM 30m (공공 영역), [OpenTopoData](https://www.opentopodata.org/) API로 받음
