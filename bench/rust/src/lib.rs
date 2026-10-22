mod kernels;

use worker::js_sys::{global, Uint8Array};
use worker::wasm_bindgen::JsCast;
use worker::wasm_bindgen_futures::JsFuture;
use web_sys::WorkerGlobalScope;
use futures_util::stream::{self, StreamExt};
use worker::{event, Context, Env, Fetcher, Request, Response, ResponseBuilder, Result};

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

fn fnv1a(bytes: &[u8]) -> u32 {
    bytes.iter().fold(0x811c9dc5u32, |hash, byte| (hash ^ u32::from(*byte)).wrapping_mul(0x01000193))
}

/// One shard's checksum, or None if the origin's reply is not the expected bytes.
async fn shard(origin: &Fetcher, seed: usize, id: usize, bytes: usize, delay: usize) -> Result<Option<u32>> {
    let url = format!("https://origin.test/shard?seed={seed}&id={id}&bytes={bytes}&delay={delay}");
    let mut response = origin.fetch(url, None).await?;
    let body = response.bytes().await?;
    Ok((response.status_code() == 200 && body.len() == bytes).then(|| fnv1a(&body)))
}

/// Fetches every shard, at most `parallel` at a time, and returns [seed][items]
/// then [id][bytes][checksum] per shard (u32 LE), or None if any shard failed.
async fn aggregate(env: &Env, items: usize, parallel: usize, bytes: usize, delay: usize, seed: usize) -> Result<Option<Vec<u8>>> {
    let origin = env.service("ORIGIN")?;
    let checksums: Vec<Result<Option<u32>>> = stream::iter(0..items)
        .map(|id| shard(&origin, seed, id, bytes, delay))
        .buffered(parallel)
        .collect()
        .await;
    let mut output = Vec::with_capacity(8 + 12 * items);
    output.extend_from_slice(&(seed as u32).to_le_bytes());
    output.extend_from_slice(&(items as u32).to_le_bytes());
    for (id, checksum) in checksums.into_iter().enumerate() {
        let Ok(Some(checksum)) = checksum else { return Ok(None) };
        output.extend_from_slice(&(id as u32).to_le_bytes());
        output.extend_from_slice(&(bytes as u32).to_le_bytes());
        output.extend_from_slice(&checksum.to_le_bytes());
    }
    Ok(Some(output))
}

async fn sha256(input: &[u8]) -> Result<Vec<u8>> {
    let scope: WorkerGlobalScope = global().unchecked_into();
    let promise = scope.crypto()?.subtle().digest_with_str_and_u8_array("SHA-256", input)?;
    Ok(Uint8Array::new(&JsFuture::from(promise).await?).to_vec())
}

#[event(fetch)]
async fn fetch(mut request: Request, env: Env, _ctx: Context) -> Result<Response> {
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
        "/aggregate" => {
            let params = kernels::parse_query(query(&request).as_deref(), ["items", "parallel", "bytes", "delay", "seed"]);
            let Some([items, parallel, bytes, delay, seed]) = params.filter(|[i, p, b, d, _]| kernels::valid_aggregate(*i, *p, *b, *d)) else {
                return text("invalid aggregate request", 400);
            };
            return match aggregate(&env, items, parallel, bytes, delay, seed).await? {
                Some(output) => binary(output),
                None => text("upstream failed", 502),
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
