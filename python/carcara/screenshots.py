"""Atualiza a imagem dos cases com um screenshot do site publicado."""
import io

from PIL import Image
from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import sync_playwright

WIDTH, HEIGHT = 1000, 611  # mesmo formato dos cards da landing


def to_webp(png: bytes) -> bytes:
    img = Image.open(io.BytesIO(png)).convert("RGB")
    # corta na proporção do card (1000x611) a partir do topo e reduz
    crop_h = round(img.width * HEIGHT / WIDTH)
    img = img.crop((0, 0, img.width, min(crop_h, img.height))).resize((WIDTH, HEIGHT), Image.LANCZOS)
    out = io.BytesIO()
    img.save(out, "WEBP", quality=80)
    return out.getvalue()


def capture(browser, url: str) -> bytes:
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    try:
        page.goto(url, wait_until="load", timeout=45_000)
        try:
            page.wait_for_load_state("networkidle", timeout=6_000)
        except PlaywrightError:
            pass  # sites com conexões sempre abertas nunca ficam ociosos; o carregamento já bastou
        page.wait_for_timeout(1500)  # animações de entrada
        return to_webp(page.screenshot(type="png"))
    finally:
        page.close()


def launch(p):
    # usa o Chromium do Playwright; sem ele instalado, cai no Chrome do sistema
    try:
        return p.chromium.launch()
    except PlaywrightError:
        return p.chromium.launch(channel="chrome")


def run(conn, only_id: int | None = None, refresh_all: bool = False) -> int:
    where, params = "demo_url IS NOT NULL", []
    if only_id:
        where += " AND id = %s"
        params.append(only_id)
    elif not refresh_all:
        where += " AND image IS NULL AND image_path IS NULL"  # só quem ainda não tem imagem
    cases = conn.execute(f"SELECT id, title, demo_url FROM cases WHERE {where} ORDER BY position, id", params).fetchall()
    if not cases:
        print("Nenhum case para atualizar (use --all para refazer todos).")
        return 0

    done = 0
    with sync_playwright() as p:
        browser = launch(p)
        try:
            for case in cases:
                try:
                    webp = capture(browser, case["demo_url"])
                except Exception as exc:
                    print(f"#{case['id']} {case['title']}: falhou ({exc})")
                    continue
                conn.execute("UPDATE cases SET image = %s, image_mime = 'image/webp', image_at = now() WHERE id = %s", (webp, case["id"]))
                conn.commit()
                print(f"#{case['id']} {case['title']}: {len(webp) // 1024} KB")
                done += 1
        finally:
            browser.close()
    return done
