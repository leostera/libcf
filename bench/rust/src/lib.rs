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
