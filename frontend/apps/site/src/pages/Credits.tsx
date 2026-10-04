import { creditsPage } from "../content/solutions";
import { PHOTOS } from "../content/photos";

export function Credits() {
    return (
        <section className="band">
            <div className="wrap narrow">
                <h1 className="h1">{creditsPage.title}</h1>
                <p className="lede mt-4">
                    {creditsPage.lede} <a href={creditsPage.licenseUrl}>{creditsPage.license}</a>
                </p>
                <table className="tbl credits mt-10">
                    <thead>
                        <tr>
                            <th>{creditsPage.columns.subject}</th>
                            <th>{creditsPage.columns.photographer}</th>
                            <th>{creditsPage.columns.source}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {Object.entries(PHOTOS).map(([name, p]) => (
                            <tr key={name}>
                                <td>{p.subject}</td>
                                <td>{p.photographer}</td>
                                <td>
                                    <a href={p.source}>{creditsPage.view}</a>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    );
}
