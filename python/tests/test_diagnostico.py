import httpx
import pytest

from carcara import diagnostico as d

GOOD = """<!doctype html><html lang="pt-BR"><head><title>Padaria Sabor da Terra | Bolos e pães artesanais</title>
<meta name="description" content="Bolos, pães e doces artesanais feitos todos os dias em Juazeiro do Norte. Encomende pelo site e retire na loja.">
<meta name="viewport" content="width=device-width"><link rel="canonical" href="https://x.com/"><meta property="og:title" content="x"></head>
<body><h1>Padaria</h1><img src="a.png" alt="Bolo"></body></html>""".encode()
BAD = b"<html><body><h1>a</h1><h1>b</h1><img src='a.png'></body></html>"


def fetched(body, url="https://x.com/", headers=None, seconds=0.3, status=200):
    return d.Fetched(url, status, httpx.Headers(headers or {}), body, seconds, 0)


@pytest.mark.parametrize("raw", ["", "ftp://x.com", "http://user:pw@x.com", "http://x.com:8080", "javascript:alert(1)", "a" * 400])
def test_normalize_rejects(raw):
    with pytest.raises(d.UrlRejected):
        d.normalize_url(raw)


def test_normalize_adds_scheme():
    assert d.normalize_url("exemplo.com.br") == "https://exemplo.com.br"


@pytest.mark.parametrize("host", ["127.0.0.1", "10.0.0.5", "192.168.1.1", "169.254.169.254", "::1", "0.0.0.0", "100.64.0.1"])
def test_private_hosts_rejected(host):
    with pytest.raises(d.UrlRejected):
        d.assert_public(host)


def test_public_ip_accepted():
    d.assert_public("93.184.216.34")


def test_redirect_to_internal_address_is_blocked():
    def handler(request):
        if request.url.host == "93.184.216.34":
            return httpx.Response(302, headers={"location": "http://169.254.169.254/latest/meta-data"})
        raise AssertionError("não deveria buscar o endereço interno")

    client = httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=False)
    with pytest.raises(d.UrlRejected):
        d.fetch("http://93.184.216.34/", client)


def test_redirect_loop_is_capped():
    client = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(302, headers={"location": "http://93.184.216.34/"})), follow_redirects=False)
    with pytest.raises(d.UrlRejected):
        d.fetch("http://93.184.216.34/", client)


def test_body_is_capped():
    client = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, content=b"x" * (d.MAX_BYTES * 3))))
    assert len(d.fetch("http://93.184.216.34/", client).body) <= d.MAX_BYTES


def test_good_site_scores_higher_than_bad():
    sec = {"strict-transport-security": "max-age=1", "content-security-policy": "default-src 'self'", "x-content-type-options": "nosniff", "content-encoding": "gzip", "cache-control": "max-age=60"}
    good = d.analyze(fetched(GOOD, headers=sec))
    bad = d.analyze(fetched(BAD, url="http://x.com/", seconds=4))
    assert good.score >= 95
    assert bad.score <= 35
    assert any(f.level == "problema" and "HTTPS" in f.title for f in bad.findings)
    assert all(0 <= r.score <= 100 for r in (good, bad))


def test_to_dict_shape():
    out = d.to_dict(d.analyze(fetched(GOOD)))
    assert set(out) == {"url", "score", "stats", "findings"}
    assert {"area", "level", "title", "advice"} == set(out["findings"][0])
