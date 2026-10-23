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

## 출처

- 지도 © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, ODbL. `campus.json`은 ODbL을 따른다
- 표고 NASA SRTM, [OpenTopoData](https://www.opentopodata.org/) API로 받음
- 코드는 [MIT](LICENSE)
