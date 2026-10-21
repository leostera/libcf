mod kernels;

use worker::js_sys::{global, Uint8Array};
use worker::wasm_bindgen::JsCast;
use worker::wasm_bindgen_futures::JsFuture;
use web_sys::WorkerGlobalScope;
use worker::{event, Context, Env, Request, Response, ResponseBuilder, Result};

const BODY_LIMIT: usize = 1024 * 1024;

fn text(body: impl Into<Vec<u8>>, status: u16) -> Result<Response> {
    Ok(ResponseBuilder::new()
        .with_status(status)
        .with_header("content-type", "text/plain; charset=utf-8")?
        .fixed(body.into()))
}

// The raw query string. Request::url() would link the url crate's IDNA tables,
// roughly 90 KB of gzipped Wasm, for a value already parsed by the runtime.
fn query(request: &Request) -> Option<String> {
    let url = request.inner().url();
    let start = url.find('?')? + 1;
    let end = url[start..].find('#').map_or(url.len(), |end| start + end);
    Some(url[start..end].to_owned())
}

fn binary(body: Vec<u8>) -> Result<Response> {
    Ok(ResponseBuilder::new()
        .with_header("content-type", "application/octet-stream")?
        .fixed(body))
}

async fn sha256(input: &[u8]) -> Result<Vec<u8>> {
    let scope: WorkerGlobalScope = global().unchecked_into();
    let promise = scope.crypto()?.subtle().digest_with_str_and_u8_array("SHA-256", input)?;
    Ok(Uint8Array::new(&JsFuture::from(promise).await?).to_vec())
}

#[event(fetch)]
async fn fetch(mut request: Request, _env: Env, _ctx: Context) -> Result<Response> {
    let input = request.bytes().await?;
    if input.len() > BODY_LIMIT {
        return text("body too large", 413);
    }
    let path = request.path();
    let iterations = match path.as_str() {
        "/hello" => return text("ok", 200),
        "/echo" => return text(input, 200),
        "/image" => {
            return match kernels::parse_query(query(&request).as_deref(), ["w", "h"]) {
                Some([w, h]) if kernels::valid_image(w, h, input.len()) => binary(kernels::image(&input, w, h)),
                _ => text("invalid image request", 400),
            };
        }
        "/search" => {
            return match kernels::parse_query(query(&request).as_deref(), ["n", "d", "q", "k"]) {
                Some([n, d, q, k]) if kernels::valid_search(n, d, q, k, input.len()) => {
                    binary(kernels::search(&input, n, d, q, k))
                }
                _ => text("invalid search request", 400),
            };
        }
        "/digest/1" => 1,
        "/digest/16" => 16,
        _ => return text("not found", 404),
    };
    let mut digest = Vec::new();
    for _ in 0..iterations {
        digest = sha256(&input).await?;
    }
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = Vec::with_capacity(64);
    for byte in digest {
        output.push(HEX[usize::from(byte >> 4)]);
        output.push(HEX[usize::from(byte & 15)]);
    }
    text(output, 200)
}
